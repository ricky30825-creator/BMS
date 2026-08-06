#!/usr/bin/env python3
"""KiCad 회로도(.kicad_sch) 생성 공용 모듈.

모드 1 전용 회로와 모드 1·2 통합 회로가 같은 심볼 라이브러리와 같은 직렬화
규칙을 쓰므로, 배치·결선 데이터(무엇을 어디에 잇는가)만 각 생성기에 두고
s-expression 출력은 여기로 모았다.

배선은 전부 글로벌 라벨로 잇는다. 긴 배선이 교차하지 않아 좌표가 단순하고,
"같은 이름끼리 연결"로 읽을 수 있다.

⚠️ 회로도 텍스트에 한글을 넣으려면 (font (face "Apple SD Gothic Neo") ...)를
   명시해야 한다. 안 붙이면 kicad-cli 내보내기에서 한글이 통째로 사라진다.
   제목란(title_block)은 폰트 지정이 안 먹으므로 ASCII만 쓴다.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

GRID = 1.27      # KiCad 연결 격자
PITCH = 5.08     # 핀 세로 간격. 2.54로 하면 글로벌 라벨끼리 세로로 붙어 안 읽힌다
PIN_LEN = 5.08
STUB = 5.08      # 핀 끝에서 글로벌 라벨까지의 짧은 배선

NS = uuid.UUID("6f1b6a1e-0000-4000-8000-000000000000")

FONT = '(font (face "Apple SD Gothic Neo") (size 1.27 1.27))'


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "|".join(str(p) for p in parts)))


def snap(v: float) -> float:
    """KiCad 연결 격자(1.27mm)에 맞춘다. 안 맞으면 ERC가 endpoint_off_grid로 잡는다."""
    return round(v / 1.27) * 1.27


# ---------------------------------------------------------------- 심볼 정의

@dataclass
class Pin:
    name: str
    number: str
    etype: str = "passive"


@dataclass
class Sym:
    name: str
    ref: str
    value: str
    desc: str
    left: list[Pin] = field(default_factory=list)
    right: list[Pin] = field(default_factory=list)
    width: float = 33.02

    @property
    def rows(self) -> int:
        return max(len(self.left), len(self.right))

    @property
    def height(self) -> float:
        return self.rows * PITCH + PITCH

    def local_pins(self) -> dict[str, tuple[float, float, int]]:
        """핀 이름 -> (심볼 로컬 x, y, 각도). 로컬 좌표는 Y가 위로 증가한다."""
        w, h = self.width, self.height
        out: dict[str, tuple[float, float, int]] = {}
        for i, p in enumerate(self.left):
            out[p.name] = (-w / 2 - PIN_LEN, h / 2 - PITCH * (i + 1), 0)
        for i, p in enumerate(self.right):
            out[p.name] = (w / 2 + PIN_LEN, h / 2 - PITCH * (i + 1), 180)
        return out


def P(spec: str, etype: str = "passive") -> list[Pin]:
    """'1:VCC 2:GND' 형태를 Pin 리스트로."""
    pins = []
    for tok in spec.split():
        num, _, name = tok.partition(":")
        pins.append(Pin(name=name, number=num, etype=etype))
    return pins


# ---------------------------------------------------------------- 배치·결선

@dataclass
class Inst:
    key: str          # 심볼 이름
    ref: str          # U1, K1 ...
    x: float
    y: float
    value: str | None = None
    nets: dict[str, str] = field(default_factory=dict)   # 핀 이름 -> 네트 이름
    nc: list[str] = field(default_factory=list)          # 미연결 표시할 핀 이름

    def __post_init__(self) -> None:
        self.x, self.y = snap(self.x), snap(self.y)


_SIZES = {"h1": (3.0, 9.0), "h2": (2.5, 8.0), "": (2.0, 5.2)}


def build_notes(columns: list[tuple[float, list[tuple[str, str]]]],
                y0: float = 305.0) -> list[tuple[float, float, float, str]]:
    """주석 3단 컬럼을 (x, y, 글자크기, 문자열) 목록으로 편다.

    (제목종류, 줄) 을 순서대로 쌓고 y는 자동으로 내린다.
    """
    notes: list[tuple[float, float, float, str]] = []
    for x, lines in columns:
        y = y0
        for kind, s in lines:
            size, step = _SIZES[kind]
            if s:
                notes.append((x, y, size, s))
            y += step if s else 3.0
    return notes


# ---------------------------------------------------------------- 직렬화

@dataclass
class Schematic:
    """한 벌의 KiCad 프로젝트(.kicad_sch + .kicad_sym + sym-lib-table + .kicad_pro)."""

    out: Path
    project: str
    generator: str
    title: str
    comments: list[str]
    symbols: dict[str, Sym]
    instances: list[Inst]
    notes: list[tuple[float, float, float, str]]
    lib: str = "cellguard"
    lib_descr: str = "셀가드 전용 모듈 심볼"
    company: str = "Battery Thermal Runaway Task Force"
    paper: str = "A1"        # 주석량 때문에 A2로는 모자란다
    root_key: str = "root-sheet"

    @property
    def root(self) -> str:
        return str(uuid.uuid5(NS, self.root_key))

    # ------------------------------------------------------------ 조각들

    def sym_def(self, s: Sym) -> str:
        w, h = s.width, s.height
        loc = s.local_pins()
        lines = [
            f'\t\t(symbol "{self.lib}:{s.name}"',
            '\t\t\t(pin_names (offset 0.508))',
            '\t\t\t(exclude_from_sim no)',
            '\t\t\t(in_bom yes)',
            '\t\t\t(on_board yes)',
            f'\t\t\t(property "Reference" "{s.ref}" (at {-w/2:.2f} {h/2 + 3.81:.2f} 0)'
            f' (effects {FONT} (justify left bottom)))',
            f'\t\t\t(property "Value" "{s.value}" (at {-w/2:.2f} {h/2 + 1.27:.2f} 0)'
            f' (effects {FONT} (justify left bottom)))',
            f'\t\t\t(property "Footprint" "" (at 0 0 0) (effects {FONT} (hide yes)))',
            f'\t\t\t(property "Datasheet" "" (at 0 0 0) (effects {FONT} (hide yes)))',
            f'\t\t\t(property "Description" "{s.desc}" (at 0 0 0)'
            f' (effects {FONT} (hide yes)))',
            f'\t\t\t(symbol "{s.name}_0_1"',
            f'\t\t\t\t(rectangle (start {-w/2:.2f} {h/2:.2f}) (end {w/2:.2f} {-h/2:.2f})',
            '\t\t\t\t\t(stroke (width 0.254) (type default))',
            '\t\t\t\t\t(fill (type background))',
            '\t\t\t\t)',
            '\t\t\t)',
            f'\t\t\t(symbol "{s.name}_1_1"',
        ]
        for p in s.left + s.right:
            x, y, ang = loc[p.name]
            lines += [
                f'\t\t\t\t(pin {p.etype} line (at {x:.2f} {y:.2f} {ang}) (length {PIN_LEN})',
                f'\t\t\t\t\t(name "{p.name}" (effects {FONT}))',
                f'\t\t\t\t\t(number "{p.number}" (effects (font (face "Apple SD Gothic Neo")'
                ' (size 1.016 1.016))))',
                '\t\t\t\t)',
            ]
        lines += ['\t\t\t)', '\t\t)']
        return "\n".join(lines)

    def inst_def(self, inst: Inst) -> str:
        s = self.symbols[inst.key]
        h = s.height
        val = inst.value or s.value
        return "\n".join([
            '\t(symbol',
            f'\t\t(lib_id "{self.lib}:{s.name}")',
            f'\t\t(at {inst.x:.2f} {inst.y:.2f} 0)',
            '\t\t(unit 1)',
            '\t\t(exclude_from_sim no)',
            '\t\t(in_bom yes)',
            '\t\t(on_board yes)',
            '\t\t(dnp no)',
            f'\t\t(uuid "{uid("inst", inst.ref)}")',
            f'\t\t(property "Reference" "{inst.ref}"'
            f' (at {inst.x - s.width/2:.2f} {inst.y - h/2 - 3.81:.2f} 0)'
            f' (effects {FONT} (justify left bottom)))',
            f'\t\t(property "Value" "{val}"'
            f' (at {inst.x - s.width/2:.2f} {inst.y - h/2 - 1.27:.2f} 0)'
            f' (effects {FONT} (justify left bottom)))',
            f'\t\t(property "Footprint" "" (at {inst.x:.2f} {inst.y:.2f} 0)'
            f' (effects {FONT} (hide yes)))',
            f'\t\t(property "Datasheet" "" (at {inst.x:.2f} {inst.y:.2f} 0)'
            f' (effects {FONT} (hide yes)))',
            f'\t\t(property "Description" "{s.desc}" (at {inst.x:.2f} {inst.y:.2f} 0)'
            f' (effects {FONT} (hide yes)))',
            '\t\t(instances',
            f'\t\t\t(project "{self.project}"',
            f'\t\t\t\t(path "/{self.root}" (reference "{inst.ref}") (unit 1))',
            '\t\t\t)',
            '\t\t)',
            '\t)',
        ])

    @staticmethod
    def wire(x1: float, y1: float, x2: float, y2: float, key: str) -> str:
        return "\n".join([
            '\t(wire',
            f'\t\t(pts (xy {x1:.2f} {y1:.2f}) (xy {x2:.2f} {y2:.2f}))',
            '\t\t(stroke (width 0) (type default))',
            f'\t\t(uuid "{uid("wire", key)}")',
            '\t)',
        ])

    @staticmethod
    def glabel(name: str, x: float, y: float, ang: int, key: str) -> str:
        just = "left" if ang == 0 else "right"
        return "\n".join([
            f'\t(global_label "{name}"',
            '\t\t(shape bidirectional)',
            f'\t\t(at {x:.2f} {y:.2f} {ang})',
            f'\t\t(effects {FONT} (justify {just}))',
            f'\t\t(uuid "{uid("gl", key)}")',
            '\t\t(property "Intersheetrefs" "${INTERSHEET_REFS}" (at 0 0 0)'
            f' (effects {FONT} (hide yes)))',
            '\t)',
        ])

    @staticmethod
    def nc(x: float, y: float, key: str) -> str:
        return f'\t(no_connect (at {x:.2f} {y:.2f}) (uuid "{uid("nc", key)}"))'

    @staticmethod
    def text(x: float, y: float, size: float, s: str, key: str) -> str:
        return "\n".join([
            f'\t(text "{s}"',
            '\t\t(exclude_from_sim no)',
            f'\t\t(at {x:.2f} {y:.2f} 0)',
            '\t\t(effects (font (face "Apple SD Gothic Neo")'
            f' (size {size} {size})) (justify left bottom))',
            f'\t\t(uuid "{uid("txt", key)}")',
            '\t)',
        ])

    # ------------------------------------------------------------ 파일

    def write_symbol_library(self) -> None:
        body = "\n".join(self.sym_def(s) for s in self.symbols.values())
        # 라이브러리 파일은 들여쓰기 한 단계가 적다
        body = "\n".join(line[1:] if line.startswith("\t") else line
                         for line in body.split("\n"))
        text = (
            "(kicad_symbol_lib\n"
            "\t(version 20241209)\n"
            f'\t(generator "{self.generator}")\n'
            '\t(generator_version "9.0")\n'
            f"{body}\n"
            ")\n"
        )
        (self.out / f"{self.lib}.kicad_sym").write_text(text, encoding="utf-8")

    def write_schematic(self) -> None:
        parts: list[str] = []
        used = {i.key for i in self.instances}
        lib_defs = "\n".join(self.sym_def(self.symbols[k])
                             for k in self.symbols if k in used)

        for inst in self.instances:
            sym = self.symbols[inst.key]
            loc = sym.local_pins()
            parts.append(self.inst_def(inst))

            for pin_name, net in inst.nets.items():
                if pin_name not in loc:
                    raise KeyError(f"{inst.ref}: 심볼 {inst.key}에 핀 '{pin_name}' 없음")
                lx, ly, ang = loc[pin_name]
                # 심볼 로컬은 Y가 위로, 회로도는 Y가 아래로 증가한다
                px, py = inst.x + lx, inst.y - ly
                dx = -STUB if ang == 0 else STUB
                ex = px + dx
                key = f"{inst.ref}.{pin_name}"
                parts.append(self.wire(px, py, ex, py, key))
                # 라벨은 핀 각도의 반대로 눕혀야 심볼 바깥으로 뻗는다.
                # 같은 각도를 쓰면 라벨이 심볼 위를 덮어 핀 번호가 가려진다.
                parts.append(self.glabel(net, ex, py, 180 if ang == 0 else 0, key))

            for pin_name in inst.nc:
                lx, ly, ang = loc[pin_name]
                parts.append(self.nc(inst.x + lx, inst.y - ly, f"{inst.ref}.{pin_name}"))

        for idx, (x, y, size, s) in enumerate(self.notes):
            parts.append(self.text(x, y, size, s, idx))

        comments = "\n".join(
            f'\t\t(comment {i + 1} "{c}")' for i, c in enumerate(self.comments))

        text = "\n".join([
            "(kicad_sch",
            "\t(version 20250114)",
            f'\t(generator "{self.generator}")',
            '\t(generator_version "9.0")',
            f'\t(uuid "{self.root}")',
            f'\t(paper "{self.paper}")',
            # 제목란은 KiCad가 자체 폰트로 그려서 face 지정이 먹지 않는다.
            # 한글을 넣으면 글자가 통째로 사라지므로 ASCII로만 쓴다.
            '\t(title_block',
            f'\t\t(title "{self.title}")',
            f'\t\t(company "{self.company}")',
            comments,
            '\t)',
            '\t(lib_symbols',
            lib_defs,
            '\t)',
            "\n".join(parts),
            '\t(sheet_instances',
            '\t\t(path "/" (page "1"))',
            '\t)',
            '\t(embedded_fonts no)',
            ")",
            "",
        ])
        (self.out / f"{self.project}.kicad_sch").write_text(text, encoding="utf-8")

    def write_project_files(self) -> None:
        (self.out / "sym-lib-table").write_text(
            "(sym_lib_table\n"
            "  (version 7)\n"
            f'  (lib (name "{self.lib}")(type "KiCad")'
            f'(uri "${{KIPRJMOD}}/{self.lib}.kicad_sym")'
            f'(options "")(descr "{self.lib_descr}"))\n'
            ")\n",
            encoding="utf-8",
        )
        (self.out / f"{self.project}.kicad_pro").write_text(
            '{\n'
            '  "board": {},\n'
            '  "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},\n'
            '  "meta": {"filename": "' + self.project + '.kicad_pro", "version": 3},\n'
            '  "schematic": {"legacy_lib_dir": "", "legacy_lib_list": []},\n'
            '  "sheets": [["' + self.root + '", "Root"]],\n'
            '  "text_variables": {}\n'
            '}\n',
            encoding="utf-8",
        )

    def write(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        self.write_symbol_library()
        self.write_schematic()
        self.write_project_files()
        nets = sorted({n for i in self.instances for n in i.nets.values()})
        print(f"생성 완료: {self.out}")
        print(f"  심볼 {len(self.symbols)}종 / 인스턴스 {len(self.instances)}개"
              f" / 네트 {len(nets)}개")
        print("  네트: " + ", ".join(nets))
