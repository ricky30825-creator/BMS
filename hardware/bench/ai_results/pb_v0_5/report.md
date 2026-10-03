# Baseline training report (v0.5.0)

Runs: 13; normal windows: 15434; synthetic dev/confirmation: 3120/3120.

Normal FAR reuses the training runs (development number, not unseen-device performance).
Synthetic TPR measures designed proxy patterns, not real thermal runaway.

| Model | Normal FAR | Proxy TPR | Proxy AUROC |
| --- | ---: | ---: | ---: |
| AE_best | 1.00% | 69.04% | 0.8658 |
| Informer_best | 1.00% | 91.47% | 0.9768 |
| Selected_fusion | 1.00% | 91.35% | 0.9767 |

## Selected configuration

```json
{
  "ae": {
    "id": "ae_local_relative6_e6_per_run_top1",
    "model": "ae",
    "features": "local_relative6",
    "epoch": 6,
    "scope": "per_run",
    "topk": 1,
    "threshold": 1.013997516455067,
    "checkpoint": "ae_local_relative6/model_epoch6.pt",
    "scaler": "ae_local_relative6/metadata_epoch6.json"
  },
  "informer": {
    "id": "informer_local_relative6_e6_per_run_top1",
    "model": "informer",
    "features": "local_relative6",
    "epoch": 6,
    "scope": "per_run",
    "topk": 1,
    "threshold": 1.008317119423852,
    "checkpoint": "informer_local_relative6/model_epoch6.pt",
    "scaler": "informer_local_relative6/metadata_epoch6.json"
  },
  "fusion": {
    "ae": "ae_local_relative6_e6_per_run_top1",
    "informer": "informer_local_relative6_e6_per_run_top1",
    "kind": "weighted_sum",
    "alpha_ae": 0.05,
    "normal_far": 0.010042762731631462,
    "tpr": 0.916025641025641,
    "auc": 0.9757164605782106,
    "precision": 0.9485562562230335,
    "f1": 0.9320071743029512,
    "threshold": 0.9764090498087291
  }
}
```
