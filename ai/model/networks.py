"""Model definitions: LSTM-Autoencoder (present state) and InformerLite (future state)."""
from __future__ import annotations

import math

import torch
from torch import nn


class LSTMAutoencoder(nn.Module):
    """Reconstructs the 96-second history; reconstruction error = current anomaly."""

    def __init__(self, n_features: int, hidden_size: int = 64, latent_size: int = 16):
        super().__init__()
        self.encoder = nn.LSTM(n_features, hidden_size, batch_first=True)
        self.to_latent = nn.Linear(hidden_size, latent_size)
        self.from_latent = nn.Linear(latent_size, hidden_size)
        self.decoder = nn.LSTM(hidden_size, hidden_size, batch_first=True)
        self.output = nn.Linear(hidden_size, n_features)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        _, (hidden, _) = self.encoder(x)
        z = self.to_latent(hidden[-1])
        decoder_input = self.from_latent(z).unsqueeze(1).repeat(1, x.size(1), 1)
        decoded, _ = self.decoder(decoder_input)
        return self.output(decoded)


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 512):
        super().__init__()
        positions = torch.arange(max_len).unsqueeze(1)
        scales = torch.exp(torch.arange(0, d_model, 2) * (-math.log(10000.0) / d_model))
        encoding = torch.zeros(max_len, d_model)
        encoding[:, 0::2] = torch.sin(positions * scales)
        encoding[:, 1::2] = torch.cos(positions * scales)
        self.register_buffer("encoding", encoding.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.encoding[:, : x.size(1)]


class InformerLite(nn.Module):
    """Compact Informer-style forecaster: predicts the next 32 seconds from 96.

    Uses PyTorch's full-attention encoder instead of ProbSparse attention; the
    forecasting role and the interface are the same, so ProbSparse can be
    swapped in later without touching training or scoring code.
    """

    def __init__(self, n_features: int, pred_len: int, d_model: int = 32, nhead: int = 4):
        super().__init__()
        self.pred_len = pred_len
        self.input_projection = nn.Linear(n_features, d_model)
        self.position = PositionalEncoding(d_model)
        layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=d_model * 4,
            dropout=0.1, batch_first=True, norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=2)
        self.future_queries = nn.Parameter(torch.randn(pred_len, d_model) * 0.02)
        self.decoder = nn.Sequential(nn.Linear(d_model * 2, d_model), nn.GELU(), nn.Linear(d_model, n_features))

    def forward(self, history: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(self.position(self.input_projection(history)))
        context = encoded[:, -1:, :].expand(-1, self.pred_len, -1)
        queries = self.future_queries.unsqueeze(0).expand(history.size(0), -1, -1)
        return self.decoder(torch.cat([context, queries], dim=-1))


def build_model(model_name: str, n_features: int, pred_len: int = 32) -> nn.Module:
    if model_name == "ae":
        return LSTMAutoencoder(n_features, 64, 16)
    if model_name == "informer":
        return InformerLite(n_features, pred_len, 32, 4)
    raise ValueError(f"Unknown model: {model_name}")
