import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal, StatusBadge } from "../components/ui";

describe("status UI", () => {
  it("communicates grade with shape, label, and score", () => {
    render(<StatusBadge grade="DANGER" score={0.82} />);
    expect(screen.getByRole("generic", { name: "위험 82" })).toBeInTheDocument();
    expect(screen.getByText("위험")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(document.querySelector(".grade-shape.square")).toBeInTheDocument();
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
