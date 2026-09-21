"""CellGuard anomaly-detection baseline (v0.5).

Normal-only LSTM-Autoencoder + InformerLite trained on 1-second discharge
telemetry, scored by calibrated feature-wise error and fused with Max Fusion.

Modules
-------
preprocess  Raw device CSV (ina/soc/temp) -> 1-second processed run CSV
features    Window extraction and the ``local_relative6`` input transform
networks    LSTMAutoencoder and InformerLite definitions
scoring     Feature-wise error, calibration, fusion, metrics
synthetic   Physically constrained proxy anomalies used only for evaluation
train       Train both models on normal runs and select the fusion setting
predict     Score one 133-row physical sample with a saved configuration
adapter     Runtime bridge skeleton for ``ai.runtime`` (not yet functional)

Trained checkpoints, processed CSV files, and raw measurements are never
committed; see README.md.
"""

BASELINE_VERSION = "0.5.0"
