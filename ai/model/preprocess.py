"""Raw device CSV -> 1-second processed run CSV.

Each run directory holds ``ina.csv`` (~0.1 s), ``soc.csv`` (1 s) and
``temp.csv`` (1-3 s).  The three streams are aligned on a common 1-second
grid, discharge current/power are made positive, temperature columns are
unified, short gaps are interpolated and a coarse phase label is attached.

Directory layout expected under ``--data-root``::

    PB5000/run_03_1A/{ina,soc,temp}.csv        power bank unit
    PB10000B/run_11_2A/...                     second physical unit -> suffix B
    18650/BAT01/run_b1_1A/...                  single cell (one folder per cell)

The processed file name is ``<battery_id>_<run_id>.csv``.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

FEATURES = [
    "voltage_v",
    "current_discharge_a",
    "power_discharge_w",
    "soc_pct",
    "cell_temp_c",
    "ir_a_temp_c",
    "ir_b_temp_c",
    "delta_c",
    "ir_diff_5a_c",
    "ir_diff_5b_c",
]

RUN_PATTERNS = {
    "powerbank": "PB*/run_*/ina.csv",
    "cell": "18650/*/run_*/ina.csv",
}


def read_csv(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce")
    frame = frame.dropna(subset=["timestamp"]).sort_values("timestamp")
    return frame.drop_duplicates("timestamp", keep="last")


def load_ina(run_dir: Path) -> pd.DataFrame:
    files = [run_dir / "ina.csv"]
    if (run_dir / "ina_part2.csv").exists():
        files.append(run_dir / "ina_part2.csv")
    frame = pd.concat([read_csv(path) for path in files], ignore_index=True).sort_values("timestamp")
    return frame.drop_duplicates("timestamp", keep="last")


def resample_run(run_dir: Path) -> tuple[pd.DataFrame, dict]:
    ina = load_ina(run_dir)
    soc = read_csv(run_dir / "soc.csv")
    temp = read_csv(run_dir / "temp.csv")

    start = max(ina.timestamp.min(), soc.timestamp.min(), temp.timestamp.min())
    end = min(ina.timestamp.max(), soc.timestamp.max(), temp.timestamp.max())
    if start >= end:
        raise ValueError(f"No overlapping timestamp range: {run_dir}")

    grid = pd.DataFrame({"timestamp": pd.date_range(start.ceil("s"), end.floor("s"), freq="1s")})

    # Device convention: discharge current is negative. Model convention: discharge positive.
    ina = ina.rename(columns={"current_a": "raw_current_a", "power_w": "raw_power_w"})
    ina["current_discharge_a"] = -pd.to_numeric(ina["raw_current_a"], errors="coerce")
    ina["power_discharge_w"] = ina["voltage_v"] * ina["current_discharge_a"]
    ina = ina[["timestamp", "voltage_v", "current_discharge_a", "power_discharge_w"]]

    soc = soc.rename(columns={"ds_cell_c": "cell_temp_c", "mlx5a_obj_c": "ir_a_temp_c", "mlx5b_obj_c": "ir_b_temp_c"})
    for name in ["cell_temp_c", "ir_a_temp_c", "ir_b_temp_c", "delta_c", "ir_diff_5a_c", "ir_diff_5b_c"]:
        if name not in soc:
            soc[name] = np.nan
    soc = soc[["timestamp", "soc_pct", "cell_temp_c", "ir_a_temp_c", "ir_b_temp_c", "delta_c", "ir_diff_5a_c", "ir_diff_5b_c"]]

    temp = temp.rename(columns={"ds18b20_c": "cell_temp_c", "mlx5a_obj_c": "ir_a_temp_c", "mlx5b_obj_c": "ir_b_temp_c"})
    for name in ["cell_temp_c", "ir_a_temp_c", "ir_b_temp_c", "delta_c"]:
        if name not in temp:
            temp[name] = np.nan
    temp = temp[["timestamp", "cell_temp_c", "ir_a_temp_c", "ir_b_temp_c", "delta_c"]]

    result = pd.merge_asof(grid, ina.sort_values("timestamp"), on="timestamp", direction="nearest", tolerance=pd.Timedelta("2s"))
    result = pd.merge_asof(result, soc.sort_values("timestamp"), on="timestamp", direction="nearest", tolerance=pd.Timedelta("2s"), suffixes=("", "_soc"))
    result = pd.merge_asof(result, temp.sort_values("timestamp"), on="timestamp", direction="nearest", tolerance=pd.Timedelta("4s"), suffixes=("", "_temp"))

    for name in ["cell_temp_c", "ir_a_temp_c", "ir_b_temp_c", "delta_c"]:
        soc_name, temp_name = f"{name}_soc", f"{name}_temp"
        if soc_name in result and temp_name in result:
            result[name] = result[soc_name].combine_first(result[temp_name])
        elif soc_name in result:
            result[name] = result[soc_name]
        elif temp_name in result:
            result[name] = result[temp_name]

    result["is_imputed"] = result[FEATURES].isna().any(axis=1)
    result[FEATURES] = result[FEATURES].interpolate(limit=2, limit_direction="both")
    result["data_gap_flag"] = result[FEATURES].isna().any(axis=1)

    result["phase"] = "idle"
    active = result["current_discharge_a"] > 0.10
    if active.any():
        first, last = result.index[active].min(), result.index[active].max()
        result.loc[first:last, "phase"] = "active"
        result.loc[first : min(first + 9, last), "phase"] = "startup"
        result.loc[max(last - 9, first) : last, "phase"] = "shutdown"

    meta = {
        "run_id": run_dir.name,
        "battery_id": run_dir.parent.name,
        "start": result.timestamp.min().isoformat(),
        "end": result.timestamp.max().isoformat(),
        "rows": int(len(result)),
        "features": FEATURES,
        "missing_rows": int(result["data_gap_flag"].sum()),
    }
    return result[["timestamp", *FEATURES, "phase", "is_imputed", "data_gap_flag"]], meta


def find_runs(data_root: Path, battery_type: str) -> list[Path]:
    runs = []
    for ina in sorted(data_root.glob(RUN_PATTERNS[battery_type])):
        run_dir = ina.parent
        if (run_dir / "soc.csv").exists() and (run_dir / "temp.csv").exists():
            runs.append(run_dir)
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", type=Path, required=True, help="folder containing PB*/ and 18650/")
    parser.add_argument("--output", type=Path, required=True, help="processed CSV output folder")
    parser.add_argument("--battery-type", choices=sorted(RUN_PATTERNS), default="powerbank")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    metadata = []
    for run_dir in find_runs(args.data_root, args.battery_type):
        frame, meta = resample_run(run_dir)
        meta["battery_type"] = args.battery_type
        frame.to_csv(args.output / f"{meta['battery_id']}_{meta['run_id']}.csv", index=False)
        metadata.append(meta)
        print(f"{meta['battery_id']}_{meta['run_id']}: {meta['rows']} rows, {meta['missing_rows']} gap rows", flush=True)
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"runs": len(metadata), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
