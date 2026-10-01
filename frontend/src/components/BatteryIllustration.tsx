import cellImage from "../assets/li-ion-cell.png";
import powerBankImage from "../assets/power-bank.webp";

export function BatteryIllustration({ mode }: { mode: 1 | 2 }) {
  return <img className="battery-illustration" src={mode === 2 ? powerBankImage : cellImage} alt={mode === 2 ? "보조배터리 일러스트" : "외부 셀 배터리 일러스트"} width={48} height={48} />;
}
