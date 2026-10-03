# Baseline training report (v0.5.0)

Runs: 13; normal windows: 15978; synthetic dev/confirmation: 3120/3120.

Normal FAR reuses the training runs (development number, not unseen-device performance).
Synthetic TPR measures designed proxy patterns, not real thermal runaway.

| Model | Normal FAR | Proxy TPR | Proxy AUROC |
| --- | ---: | ---: | ---: |
| AE_best | 1.00% | 67.88% | 0.8681 |
| Informer_best | 1.00% | 90.26% | 0.9718 |
| Selected_fusion | 1.00% | 90.22% | 0.9691 |

## Selected configuration

```json
{
  "ae": {
    "id": "ae_local_relative6_e6_per_run_top2",
    "model": "ae",
    "features": "local_relative6",
    "epoch": 6,
    "scope": "per_run",
    "topk": 2,
    "threshold": 1.0046524563936592,
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
    "threshold": 1.0083452643803572,
    "checkpoint": "informer_local_relative6/model_epoch6.pt",
    "scaler": "informer_local_relative6/metadata_epoch6.json"
  },
  "fusion": {
    "ae": "ae_local_relative6_e6_per_run_top2",
    "informer": "informer_local_relative6_e6_per_run_top1",
    "kind": "max",
    "alpha_ae": null,
    "normal_far": 0.010013768932281888,
    "tpr": 0.907051282051282,
    "auc": 0.9680684238103032,
    "precision": 0.9464882943143813,
    "f1": 0.9263502454991818,
    "threshold": 1.3594715084898537
  }
}
```
