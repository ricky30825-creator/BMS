import { useId } from "react";
import type { Grade } from "../types";
import cellImage from "../assets/li-ion-cell.png";
import powerBankImage from "../assets/power-bank.webp";

export function BatteryIllustration({ mode, grade }: { mode: 1 | 2; grade?: Grade | null }) {
  const filterId = `battery-tint-${useId().replace(/:/g, "")}`;
  const tinted = grade === "CAUTION" || grade === "WARNING" || grade === "DANGER";
  return <>
    {tinted && <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}><defs>
      <filter id={filterId} colorInterpolationFilters="sRGB">
        {/* Green excess isolates the body, preserving black outlines, gray caps and orange bolts. */}
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -12 12 0 0 0" result="green" />
        <feComposite in="green" in2="SourceAlpha" operator="in" result="mask" />
        <feFlood style={{ floodColor: `var(--grade-${grade.toLowerCase()})` }} result="color" />
        <feComposite in="color" in2="mask" operator="in" result="body" />
        <feComposite in="body" in2="SourceGraphic" operator="over" />
      </filter>
    </defs></svg>}
    <img className={`battery-illustration${mode === 1 ? " battery-illustration-cell" : ""}`} style={tinted ? { filter: `url(#${filterId})` } : undefined} src={mode === 2 ? powerBankImage : cellImage} alt={mode === 2 ? "보조배터리 일러스트" : "외부 셀 배터리 일러스트"} width={48} height={48} />
  </>;
}
