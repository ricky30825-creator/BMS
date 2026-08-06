# 모드 1·2 통합 계측 회로도 (`COMBINED_EXISTING_PARTS_V1`)

보유한 INA226 1개와 4채널 릴레이 1개로 **모드 1(외부 셀) 전체**와 **모드 2(USB 보조배터리)의 방전 계측 경로**를 한 회로에 담은 것.

## 파일

| 파일 | 용도 |
|---|---|
| `cellguard_combined.kicad_pro` | KiCad 프로젝트 — **이걸 연다** |
| `cellguard_combined.kicad_sch` | 회로도 본체 |
| `cellguard.kicad_sym` | 프로젝트 자체 심볼 라이브러리 |
| `sym-lib-table` | 위 라이브러리 등록 |
| `cellguard_combined.svg` | KiCad 없이 브라우저로 볼 수 있는 렌더 결과 |

**폴더째로 옮긴다.** 파일 하나만 복사하면 심볼을 못 찾는다.

## 모드 1 전용 회로(`hardware/mode1/`)와 갈리는 곳 세 가지

| | 모드 1 전용 | 통합 |
|---|---|---|
| CH4 (GPIO19) | 미배선 예비 채널 | **모드 선택** — `OFF/NC`=모드 1, `ON/NO`=모드 2 방전 |
| INA226 `IN−`·`VBUS` | `CELL_P` (셀 + 직결) | **`SOURCE_P`** — 셀 + 와 USB-A `VBUS` 중 한 가닥만 번갈아 체결 |
| 전력 GND 스플라이스 | 5가닥 | **6가닥** (`PB_N` 추가) |

CH1·CH2·CH3의 역할과 GPIO는 두 회로가 같다 — 안전 인터락 코드를 한 벌로 유지하기 위한 것이다.

```text
INA226 IN+ ── CH3 NO ── CH4 COM ─┬─ CH4 NC ── Babysitter BAT+   [모드 1]
                                 └─ CH4 NO ── BW150 부하 +      [모드 2]
```

`BW150 부하 +`(`LOAD_P`)에는 CH2 NO와 CH4 NO 두 선이 함께 붙는다.

## ⚠️ `SOURCE_P`에는 한 번에 양극 한 가닥만

셀 홀더 `+`와 USB-A `VBUS`를 같은 점에 동시에 물면 **셀과 보조배터리가 서로를 향해 방전한다.** 이 회로에는 그것을 막을 다이오드도 퓨즈도 없다 — 하드웨어 인터락이 아니라 **작업 절차**로만 막는다. 회로도의 `TB1`은 그 단일 체결점을 나타낸 것이지 전환 스위치가 아니다.

## 이 회로가 못 하는 것

모드 2 자동 충전 경로·충전 전류 측정·MQ-2 가스 안전계층이 없고 안전 문턱이 확정되지 않아, **제품 F21 진단으로 승격하지 않는다**(API는 `409 SAFETY_PROFILE_NOT_READY`). 모드 2는 **0.1A → 0.5A·각 10초 시운전까지만** 허용한다.

## 같이 볼 문서

- 조립·배선·안전: `docs/hardware/mode1_mode2_combined_beginner_guide.md` (**정본**)
- 모드 2 판정 계약: `docs/hardware/mode2_powerbank_diagnosis_spec.md`
- 릴레이 상태·Raw 필드 계약: `docs/hardware/mode1_backend_spec.md` §8-4-1

## 고칠 때

**KiCad에서 직접 고치지 마라.** 이 파일들은 생성물이라 손으로 고친 내용이 다음 실행 때 날아간다.

```bash
python3 tools/gen_combined_sch.py
```

심볼 정의는 `tools/cellguard_symbols.py`, s-expression 직렬화는 `tools/kicad_sch.py`에 있고 **모드 1 회로와 공유한다.** 그 두 파일을 고쳤으면 `tools/gen_mode1_sch.py`도 다시 돌려 `hardware/mode1/`에 변화가 없는지 확인한다.

생성 후 검증:

```bash
K=/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli

# 파싱 + ERC (0건이어야 한다)
$K sch erc --severity-all -o /tmp/combined.erc hardware/combined/cellguard_combined.kicad_sch

# 연결 관계 확인
$K sch export netlist --format kicadsexpr -o /tmp/combined.net hardware/combined/cellguard_combined.kicad_sch

# 렌더 갱신
$K sch export svg --output hardware/combined/ hardware/combined/cellguard_combined.kicad_sch
```

## 알아둘 것

- **PCB는 없다.** 기성 모듈을 배선으로 잇는 하네스라 기판을 뜨지 않는다.
- **긴 배선 대신 글로벌 라벨**을 쓴다. 같은 이름의 육각형 이름표끼리 전부 연결돼 있다는 뜻이다.
- **`CELL_N`은 `GND`와 별도 네트로 그려져 있다.** Babysitter 보드 안에서는 같은 GND지만, 셀 −를 `BAT−` 한 점에만 무는 스타 그라운드 규칙을 회로도에서 읽을 수 있게 하려는 것이다.
- **회로도 주석에 한글을 넣으려면 폰트를 명시해야 한다.** `(font (face "Apple SD Gothic Neo") ...)` 를 안 붙이면 `kicad-cli` 내보내기에서 한글이 통째로 사라진다. 제목란(title_block)은 폰트 지정이 안 먹으므로 ASCII만 쓴다.
