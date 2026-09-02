// 오늘의 계측 소스. Kafka consumer가 생기면 이 파일만 지운다.
//
// 데모 tick의 합성값을 그대로 쓰면 진단 결과가 부하와 무관해져 무의미하다.
// 그래서 부스트 컨버터 거동을 모사한다 — 자산 ID를 시드로 특성을 정하고,
// 목표 전류가 그 이탈점을 넘으면 출력전압을 처지게 하고, 부하 전력에
// 비례해 표면온도를 올린다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";
import type { DiagnosisSample, DiagnosisSource } from "./ingest.js";

type PackTraits = {
  collapseCurrentA: number;
  vLightLoadV: number;
  thermalCoeffCPerWMin: number;
  capacityWhActual: number;
};

// 결정론적 해시. 같은 자산은 항상 같은 특성을 갖는다.
function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
}

function traitsFor(battery: DemoBattery): PackTraits {
  const a = hash(battery.id);
  const b = hash(`${battery.id}:thermal`);
  const c = hash(`${battery.id}:capacity`);
  // 실제 보조배터리 IC의 출력 한계는 0.8A(HT4928S)~4.8A(IP5318)로 6배
  // 흩어진다(스펙 §9, 2026-08-08 웹 검증).
  return {
    collapseCurrentA: 0.8 + a * 1.6,          // 0.8 ~ 2.4A
    vLightLoadV: 5.02 + a * 0.1,              // 5.02 ~ 5.12V
    thermalCoeffCPerWMin: 0.25 + b * 0.75,
    capacityWhActual: (battery.capacityWh ?? 37) * (0.82 + c * 0.1),
  };
}

const AMBIENT_C = 28;
const LATCH_OFF_FACTOR = 1.35;

export function createSimulatorSource(): DiagnosisSource {
  return {
    sample(battery, diagnosis: DemoDiagnosis, elapsedMs, loadTargetA, deliveredWh): DiagnosisSample {
      const traits = traitsFor(battery);
      const load = Math.max(loadTargetA, 0);

      let voltageV: number;
      if (diagnosis.kind === "CAPACITY" && deliveredWh >= traits.capacityWhActual) {
        // 용량 소진 → 컨버터가 무너진다. 러너가 정상 컷오프로 처리한다.
        voltageV = traits.vLightLoadV * 0.6;
      } else if (load > traits.collapseCurrentA * LATCH_OFF_FACTOR) {
        // 래치오프 — IP5306류는 출력 <4.4V가 30ms 지속되면 통째로 차단한다.
        voltageV = 0.1;
      } else if (load > traits.collapseCurrentA) {
        const excess = (load - traits.collapseCurrentA) / traits.collapseCurrentA;
        voltageV = traits.vLightLoadV * (1 - 0.35 * excess);
      } else {
        voltageV = traits.vLightLoadV - load * 0.03;
      }

      const powerW = voltageV * load;
      const minutes = elapsedMs / 60_000;
      // ⚠️ 냉각도 열 기억도 없는 모델이다 — 현재 전력 × 총 경과시간이라,
      // 부하를 내려도 `minutes`가 계속 커지는 한 온도가 오른다. 그래서
      // 시뮬레이션의 recoverySlopeCPerMin(P5 회복 구간 기울기)은 항상
      // 양수로 나오며 그건 신호가 아니라 인공물이다. 실물에서 그 값이
      // 양수면 "부하를 내렸는데 내부 발열이 계속된다"는 최강 적신호지만
      // (스펙 §9-7), 여기서는 아무 뜻도 없다. **그 조건을 중단 조건으로
      // 승격하기 전에 이 모델부터 고쳐라** — 안 그러면 모든 시뮬레이션
      // 진단이 중단된다(스펙 §8 H21).
      const tempIrSurfaceC = AMBIENT_C + traits.thermalCoeffCPerWMin * powerW * minutes;

      return {
        atMs: elapsedMs,
        voltageV: Number(voltageV.toFixed(3)),
        currentA: Number((-load).toFixed(3)),   // 방전 = 음수
        tempIrSurfaceC: Number(tempIrSurfaceC.toFixed(2)),
        // 모드 2 COMBINED_EXISTING_PARTS_V1 프로필에는 MQ-2가 없다.
        gasRaw: null,
        loadTargetA: load,
      };
    },
  };
}
