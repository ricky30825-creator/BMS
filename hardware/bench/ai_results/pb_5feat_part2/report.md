# Baseline training report (v0.5.0)

Runs: 13; normal windows: 15978; synthetic dev/confirmation: 3120/3120.

Normal FAR reuses the training runs (development number, not unseen-device performance).
Synthetic TPR measures designed proxy patterns, not real thermal runaway.

| Model | Normal FAR | Proxy TPR | Proxy AUROC |
| --- | ---: | ---: | ---: |
| AE_best | 1.00% | 64.58% | 0.8521 |
| Informer_best | 1.00% | 88.40% | 0.9721 |
| Selected_fusion | 1.00% | 88.43% | 0.9721 |

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
    "threshold": 1.0037026602552475,
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
    "threshold": 1.021039561684409,
    "checkpoint": "informer_local_relative5/model_epoch6.pt",
    "scaler": "informer_local_relative5/metadata_epoch6.json"
  },
  "fusion": {
    "ae": "ae_local_relative5_e2_per_run_top2",
    "informer": "informer_local_relative5_e6_per_run_top1",
    "kind": "weighted_sum",
    "alpha_ae": 0.05,
    "normal_far": 0.010013768932281888,
    "tpr": 0.8836538461538461,
    "auc": 0.971110407017983,
    "precision": 0.9451491258141926,
    "f1": 0.9133675666721882,
    "threshold": 0.9929121039018427
  }
}
```
