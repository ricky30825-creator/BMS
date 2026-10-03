# Baseline training report (v0.5.0)

Runs: 13; normal windows: 15434; synthetic dev/confirmation: 3120/3120.

Normal FAR reuses the training runs (development number, not unseen-device performance).
Synthetic TPR measures designed proxy patterns, not real thermal runaway.

| Model | Normal FAR | Proxy TPR | Proxy AUROC |
| --- | ---: | ---: | ---: |
| AE_best | 1.00% | 63.97% | 0.8539 |
| Informer_best | 1.00% | 89.74% | 0.9763 |
| Selected_fusion | 1.00% | 89.78% | 0.9754 |

## Selected configuration

```json
{
  "ae": {
    "id": "ae_local_relative5_e2_per_run_top2",
    "model": "ae",
    "features": "local_relative5",
    "epoch": 2,
    "scope": "per_run",
    "topk": 2,
    "threshold": 1.0162637362145208,
    "checkpoint": "ae_local_relative5/model_epoch2.pt",
    "scaler": "ae_local_relative5/metadata_epoch2.json"
  },
  "informer": {
    "id": "informer_local_relative5_e6_per_run_top1",
    "model": "informer",
    "features": "local_relative5",
    "epoch": 6,
    "scope": "per_run",
    "topk": 1,
    "threshold": 1.0058005280255644,
    "checkpoint": "informer_local_relative5/model_epoch6.pt",
    "scaler": "informer_local_relative5/metadata_epoch6.json"
  },
  "fusion": {
    "ae": "ae_local_relative5_e2_per_run_top2",
    "informer": "informer_local_relative5_e6_per_run_top1",
    "kind": "weighted_sum",
    "alpha_ae": 0.15000000000000002,
    "normal_far": 0.010042762731631462,
    "tpr": 0.896474358974359,
    "auc": 0.9744087416891778,
    "precision": 0.9474932249322493,
    "f1": 0.9212779973649539,
    "threshold": 0.9171337268514542
  }
}
```
