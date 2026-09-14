"""Inference adapter boundary.

The repository does not contain PyTorch/TensorFlow model code or trained
artifacts.  ``ArtifactInferenceAdapter`` is therefore only a typed bridge for
the externally supplied implementation.  Its absence is an explicit startup
failure, never a reason to emit a made-up score.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from importlib import import_module
from inspect import isawaitable
from typing import Any

from .bundle import ModelBundle
from .contracts import InferenceAdapter, InferenceOutput, RawMetricsFrame, parse_inference_output


class InferenceAdapterError(RuntimeError):
    """A model implementation is missing or returned an invalid result."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


AdapterRunner = Callable[
    [RawMetricsFrame, ModelBundle],
    InferenceOutput | Mapping[str, Any] | Awaitable[InferenceOutput | Mapping[str, Any]],
]


class ArtifactInferenceAdapter:
    """Invoke a separately supplied implementation against a validated bundle.

    ``runner`` is intentionally required.  A future model package can inject a
    runner after loading the bundle, while tests inject a test-only adapter at
    the service boundary.  This class itself performs no feature extraction,
    score fusion, Kalman filtering, or internal-cell estimation.
    """

    def __init__(self, bundle: ModelBundle, runner: AdapterRunner | None = None) -> None:
        if runner is None:
            raise InferenceAdapterError(
                "AI_INFERENCE_ADAPTER_UNAVAILABLE",
                "no external LSTM-AE/Informer implementation is installed",
            )
        self.bundle = bundle
        self._runner = runner

    async def infer(self, frame: RawMetricsFrame) -> InferenceOutput:
        result = self._runner(frame, self.bundle)
        if isawaitable(result):
            result = await result  # type: ignore[misc]
        parsed = result if isinstance(result, InferenceOutput) else parse_inference_output(result)
        if parsed.model_version != self.bundle.model_version:
            raise InferenceAdapterError(
                "AI_INFERENCE_OUTPUT_INVALID",
                f"adapter model_version {parsed.model_version!r} does not match bundle {self.bundle.model_version!r}",
            )
        return parsed


def create_production_adapter(bundle: ModelBundle) -> InferenceAdapter:
    """Load the explicitly named external adapter from bundle metadata.

    The manifest may use ``python:package.module:create_adapter`` once the
    separately reviewed model package is installed.  Other descriptors are
    intentionally blocked rather than guessed, and fake-looking descriptors
    are rejected by the bundle loader before this function is reached.
    """

    descriptor = bundle.implementations.get("adapter", "")
    prefix = "python:"
    if not descriptor.startswith(prefix):
        raise InferenceAdapterError(
            "AI_INFERENCE_ADAPTER_UNAVAILABLE",
            "bundle must name an installed adapter as python:module:factory",
        )
    target = descriptor[len(prefix):]
    module_name, separator, factory_name = target.rpartition(":")
    if not separator or not module_name or not factory_name:
        raise InferenceAdapterError(
            "AI_INFERENCE_ADAPTER_INVALID",
            "adapter descriptor must be python:module:factory",
        )
    try:
        module = import_module(module_name)
        factory = getattr(module, factory_name)
    except (ImportError, AttributeError) as exc:
        raise InferenceAdapterError(
            "AI_INFERENCE_ADAPTER_UNAVAILABLE",
            f"cannot load external adapter {target!r}",
        ) from exc
    if not callable(factory):
        raise InferenceAdapterError("AI_INFERENCE_ADAPTER_INVALID", f"adapter factory {target!r} is not callable")
    try:
        adapter = factory(bundle)
    except Exception as exc:
        raise InferenceAdapterError("AI_INFERENCE_ADAPTER_INVALID", f"adapter factory {target!r} failed") from exc
    if not hasattr(adapter, "infer") or not callable(adapter.infer):
        raise InferenceAdapterError("AI_INFERENCE_ADAPTER_INVALID", f"adapter {target!r} has no infer(frame) method")
    return adapter
