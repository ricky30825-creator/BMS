import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../components/ui";

describe("status UI", () => {
  it("communicates grade with shape, label, and score", () => {
    render(<StatusBadge grade="DANGER" score={0.82} />);
    expect(screen.getByRole("generic", { name: "위험 82" })).toBeInTheDocument();
    expect(screen.getByText("위험")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(document.querySelector(".grade-shape.square")).toBeInTheDocument();
  });
});
