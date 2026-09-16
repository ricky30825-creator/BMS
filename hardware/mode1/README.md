# 모드 1 (외부 셀) 계측 회로도

18650 리튬이온 / 리튬폴리머 셀을 충·방전시키면서 전압·전류·전력·SOC·온도·압력을 기록하는 회로.

## 파일

| 파일 | 용도 |
|---|---|
| `cellguard_mode1.kicad_pro` | KiCad 프로젝트 — **이걸 연다** |
| `cellguard_mode1.kicad_sch` | 회로도 본체 |
| `cellguard.kicad_sym` | 프로젝트 자체 심볼 라이브러리 |
| `sym-lib-table` | 위 라이브러리 등록 |
| `cellguard_mode1.svg` | KiCad 없이 브라우저로 볼 수 있는 렌더 결과 |

**폴더째로 옮긴다.** 파일 하나만 복사하면 심볼을 못 찾는다.

## 같이 볼 문서

- Fail-Safe 실측·릴레이 인수 기록: [기록표](../../docs/hardware/failsafe_threshold_relay_acceptance.md)

- 조립·배선·안전: `docs/hardware/mode1_beginner_guide.md`
- 레지스터·샘플링·릴레이 계약: `docs/hardware/mode1_backend_spec.md`

## 고칠 때

**KiCad에서 직접 고치지 마라.** 이 파일들은 생성물이라 손으로 고친 내용이 다음 실행 때 날아간다.

```bash
python3 tools/gen_mode1_sch.py
```

생성 후 검증:

```bash
K=/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli

# 파싱 + ERC (0건이어야 한다)
$K sch erc --severity-all -o /tmp/mode1.erc hardware/mode1/cellguard_mode1.kicad_sch

# 연결 관계 확인
$K sch export netlist --format kicadsexpr -o /tmp/mode1.net hardware/mode1/cellguard_mode1.kicad_sch

# 렌더 갱신
$K sch export svg --output hardware/mode1/ hardware/mode1/cellguard_mode1.kicad_sch
```

## 알아둘 것

- **PCB는 없다.** 기성 모듈을 배선으로 잇는 하네스라 기판을 뜨지 않는다.
- **긴 배선 대신 글로벌 라벨**을 쓴다. 같은 이름의 육각형 이름표끼리 전부 연결돼 있다는 뜻이다.
- **회로도 주석에 한글을 넣으려면 폰트를 명시해야 한다.** `(font (face "Apple SD Gothic Neo") ...)` 를 안 붙이면 `kicad-cli` 내보내기에서 한글이 통째로 사라진다. 제목란(title_block)은 폰트 지정이 안 먹으므로 ASCII만 쓴다.
- **이번 회로에 가스(MQ-2)·음향 센서는 없다.** `gas_raw`, `acoustic_raw`는 `null`이 된다.
