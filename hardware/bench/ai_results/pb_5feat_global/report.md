# Baseline training report (v0.5.0)

Runs: 13; normal windows: 15978; synthetic dev/confirmation: 3120/3120.

Normal FAR reuses the training runs (development number, not unseen-device performance).
Synthetic TPR measures designed proxy patterns, not real thermal runaway.

| Model | Normal FAR | Proxy TPR | Proxy AUROC |
| --- | ---: | ---: | ---: |
| AE_best | 1.00% | 50.74% | 0.9014 |
| Informer_best | 1.00% | 75.16% | 0.9906 |
| Selected_fusion | 1.00% | 74.42% | 0.9859 |

## Selected configuration

```json
{
  "ae": {
    "id": "ae_local_relative5_e2_global_top5",
    "model": "ae",
    "features": "local_relative5",
    "epoch": 2,
    "scope": "global",
    "topk": 5,
    "threshold": 1.0,
    "checkpoint": "ae_local_relative5/model_epoch2.pt",
    "scaler": "ae_local_relative5/metadata_epoch2.json"
  },
  "informer": {
    "id": "informer_local_relative5_e6_global_top2",
    "model": "informer",
    "features": "local_relative5",
    "epoch": 6,
    "scope": "global",
    "topk": 2,
    "threshold": 1.0,
    "checkpoint": "informer_local_relative5/model_epoch6.pt",
    "scaler": "informer_local_relative5/metadata_epoch6.json"
  },
  "fusion": {
    "ae": "ae_local_relative5_e2_global_top5",
    "informer": "informer_local_relative5_e6_global_top2",
    "kind": "weighted_sum",
    "alpha_ae": 0.55,
    "normal_far": 0.010013768932281888,
    "tpr": 0.746474358974359,
    "auc": 0.9859926389169724,
    "precision": 0.9357171554841301,
    "f1": 0.8304510607951507,
    "threshold": 1.0368869525772537
  }
}
```
