import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal, StatusBadge } from "../components/ui";
import { DiagnosisAnomalyState } from "../pages/UserPages";

describe("status UI", () => {
  it("communicates grade with shape, label, and score", () => {
    render(<StatusBadge grade="DANGER" score={0.82} />);
    expect(screen.getByRole("generic", { name: "위험 82" })).toBeInTheDocument();
    expect(screen.getByText("위험")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(document.querySelector(".grade-shape.square")).toBeInTheDocument();
  });

  it("does not invent a measurement time when the latest anomaly snapshot omits it", () => {
    render(<DiagnosisAnomalyState latest={{ score: 0.82, grade: "DANGER", voltageV: null, currentA: null, representativeTempC: null, socPct: null, measuredAt: null }} />);

    expect(screen.getByLabelText("위험 82")).toBeInTheDocument();
    expect(screen.getByText("측정 시각은 서버에서 제공되지 않았습니다.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/—에 실측됐습니다/)).not.toBeInTheDocument();
  });

  it("keeps a partial anomaly snapshot unavailable instead of showing a misleading grade", () => {
    render(<DiagnosisAnomalyState latest={{ score: null, grade: null, voltageV: null, currentA: null, representativeTempC: null, socPct: null, measuredAt: null }} />);

    expect(screen.getByText("측정값 없음")).toBeInTheDocument();
    expect(screen.getByText("서버가 최근 이상점수와 등급을 함께 제공하지 않아 표시할 수 없습니다.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText(/정상|주의|경고|위험/)).not.toBeInTheDocument();
  });
});

describe("modal dismissal", () => {
  it("keeps normal close button, Escape, and backdrop dismissal", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Modal title="일반 모달" onClose={onClose}><button>확인</button></Modal>);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("blocks every dismissal route while preserving the focus trap", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal title="연결 진행" onClose={onClose} dismissible={false}><button>다시 시도</button><button>대기 상태</button></Modal>);

    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("presentation"));
    expect(onClose).not.toHaveBeenCalled();

    const first = screen.getByRole("button", { name: "다시 시도" });
    const last = screen.getByRole("button", { name: "대기 상태" });
    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("focuses a non-dismissible processing dialog when it has no actions", () => {
    render(<Modal title="측정 연결 중" onClose={vi.fn()} dismissible={false}><p>센서 응답을 기다리는 중입니다.</p></Modal>);

    expect(screen.getByRole("dialog", { name: "측정 연결 중" })).toHaveFocus();
  });
});
