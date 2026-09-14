import "dotenv/config";
import { z } from "zod";
import type { DiagnosisSafetyThresholds } from "../diagnosis/safety.js";
import { KAFKA_TOPICS } from "../kafka.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3005),
  AUTH_MODE: z.enum(["demo", "betterauth"]).default("demo"),
  DATA_MODE: z.enum(["memory", "postgres"]).default("memory"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  // Kafka is opt-in. `KAFKA_CONSUMER_ENABLED` is deliberately separate from
  // the shared Kafka switch so a PostgreSQL process cannot subscribe by
  // accident.
  KAFKA_ENABLED: z.enum(["true", "false"]).default("false"),
  KAFKA_CONSUMER_ENABLED: z.enum(["true", "false"]).default("false"),
  KAFKA_BROKERS: z.string().trim().min(1).default("127.0.0.1:9092"),
  KAFKA_CLIENT_ID: z.string().trim().min(1).default("cellguard-backend"),
  KAFKA_GROUP_ID: z.string().trim().min(1).default("cellguard-backend"),
  KAFKA_ANOMALY_GROUP_ID: z.string().trim().min(1).default("cellguard-backend-anomaly"),
  KAFKA_RAW_METRICS_TOPIC: z.string().trim().min(1).default(KAFKA_TOPICS.rawMetrics),
  KAFKA_ANOMALY_ALERTS_TOPIC: z.string().trim().min(1).default(KAFKA_TOPICS.anomalyAlerts),
  KAFKA_EVENTS_TOPIC: z.string().trim().min(1).default(KAFKA_TOPICS.events),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  // F21 진단 문턱. 전부 `0`이 미설정 sentinel이며 그 계층을 비활성화한다.
  // H2·H3 실측이 나오면 여기 숫자만 바꾼다(코드 변경 불필요).
  DIAG_SURFACE_CUTOFF_C: z.coerce.number().min(0).default(0),
  DIAG_TEMP_SLOPE_C_PER_MIN: z.coerce.number().min(0).default(0),
  DIAG_GAS_RAW: z.coerce.number().min(0).default(0),
  DIAG_S1_THERMAL_SLOPE_C_PER_MIN: z.coerce.number().min(0).default(0),
  // 부스트 효율은 0이면 절대 SOH를 못 내므로 기본값이 있다(스펙 §8 H4).
  DIAG_ASSUMED_EFFICIENCY: z.coerce.number().min(0).max(1).default(0.88),
  // ⚠️ 위 DIAG_* 문턱과 달리 이 둘은 `0`-미설정 sentinel이 아니다 — 안전
  // 계층이 동작하는 데 필요한 운영값이라 DIAG_ASSUMED_EFFICIENCY처럼 실제
  // 기본값을 준다. 창을 0으로 두면 판정이 매 tick 샘플 1개로 이뤄져
  // 노이즈에 취약해지고, 최소 표본수를 0/1로 두면 사실상 두 점 차분과
  // 같아져 스펙이 최소자승을 쓰는 이유(§3-2 ②)가 무의미해진다.
  DIAG_TEMP_SLOPE_WINDOW_MS: z.coerce.number().positive().default(60_000),
  // 하한이 3인 이유: 표본 2개에서 최소자승은 두 점 차분과 수학적으로 같아져,
  // IR 노이즈에 취약해서 최소자승을 쓰기로 한 이유가 사라진다(스펙 §3-2 ②).
  DIAG_TEMP_SLOPE_MIN_SAMPLES: z.coerce.number().int().min(3).default(5),
  GOOGLE_CLIENT_SECRET: z.string().optional()
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const diagnosisSafetyThresholds: DiagnosisSafetyThresholds = Object.freeze({
  surfaceCutoffC: env.DIAG_SURFACE_CUTOFF_C,
  tempSlopeCPerMin: env.DIAG_TEMP_SLOPE_C_PER_MIN,
  gasRaw: env.DIAG_GAS_RAW,
});

// 발열 기울기 상한. 스펙 §3-4가 "판정의 형태만 확정"이라 실측 전에는 0이며,
// 0이면 그 조건을 위반으로 보지 않고 결과에 gradeProvisional을 단다.
export const diagnosisS1CPerMin = env.DIAG_S1_THERMAL_SLOPE_C_PER_MIN;

export const diagnosisAssumedEfficiency = env.DIAG_ASSUMED_EFFICIENCY;

// 안전 판정용 롤링 온도 기울기의 응답 창과 노이즈 바닥. runner.ts의
// appendTempSample/rollingTempSlopeCPerMin이 소비한다. 실제 중단 문턱
// (DIAG_TEMP_SLOPE_C_PER_MIN 등)은 여전히 미측정(H2·H3)이라 0이지만,
// 이 둘은 그 문턱이 뭐든 상관없이 판정 창 자체를 정하는 값이라 별도다.
export const diagnosisTempSlopeWindowMs = env.DIAG_TEMP_SLOPE_WINDOW_MS;
export const diagnosisTempSlopeMinSamples = env.DIAG_TEMP_SLOPE_MIN_SAMPLES;

// Deliberately no Kafka client is instantiated here. Keeping the connection
// configuration as a parsed value lets memory-mode startup remain independent
// of broker availability; the later producer/consumer step owns connection
// lifecycle and should check `enabled` before connecting.
export const kafkaConfig = Object.freeze({
  enabled: env.KAFKA_ENABLED === "true",
  brokers: env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()).filter(Boolean),
  clientId: env.KAFKA_CLIENT_ID,
  groupId: env.KAFKA_GROUP_ID,
  anomalyGroupId: env.KAFKA_ANOMALY_GROUP_ID,
  topics: Object.freeze({
    rawMetrics: env.KAFKA_RAW_METRICS_TOPIC,
    anomalyAlerts: env.KAFKA_ANOMALY_ALERTS_TOPIC,
    events: env.KAFKA_EVENTS_TOPIC,
  }),
});

export const kafkaConsumerConfig = Object.freeze({
  enabled: env.KAFKA_CONSUMER_ENABLED === "true",
});
