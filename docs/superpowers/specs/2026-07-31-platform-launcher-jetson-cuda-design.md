# Platform Launcher and Jetson CUDA Training Verification Design

## Goal

Make `./run.sh` a safe, keyboard-driven platform launcher for ObjectAutoLabel.
The operator selects either `x86_64 / amd64` or `Jetson / aarch64`; the
launcher then performs a cached rebuild, starts the matching Docker image, and
reports actionable validation results. Preserve the existing scripted
lifecycle commands and prove that the Jetson container can perform a real
CUDA-backed YOLO training smoke test rather than merely start.

## User Experience

Running `./run.sh` with no arguments opens a two-option terminal menu:

1. `x86_64 / amd64`
2. `Jetson / aarch64`

The detected native platform is selected initially. The up/down and left/right
arrow keys move the selection, Enter confirms it, and `q` cancels. Confirmation
saves the existing internal mode (`desktop` or `jetson`) in `.run-mode`, runs a
normal cache-enabled Docker Compose build, starts the service, and performs the
startup health check.

`./run.sh --up` uses the same selector in an interactive terminal. In
non-interactive use it resolves `OBJECT_AUTOLABEL_MODE`, the saved mode, or the
detected native platform without waiting for keyboard input. Existing
`--down`, `--down_up`, `--logs`, `--status`, `--mode`, `--detect`, and `--plan`
interfaces remain available. `--plan` may describe either platform on any host
because it does not build or run a container.

The public platform labels are architecture names. The implementation keeps
the established `desktop` and `jetson` internal values so existing mode files,
scripts, Compose selection, and documentation links remain compatible.

## Runtime Safety

Before a real build or start, the launcher validates that the selected platform
matches the native CPU architecture:

- `x86_64` or `amd64` may start the desktop Compose stack.
- `aarch64` or `arm64` may start the Jetson Compose stack.
- A mismatch fails before Docker build with the detected architecture, selected
  platform, and a hint to choose the matching menu entry.

Jetson startup additionally requires an L4T release and an available NVIDIA
Docker runtime. The existing runtime detector continues mapping L4T/JetPack to
an NVIDIA PyTorch base-image candidate. A real start must not silently fall
back to the desktop image or CPU. Manifest lookup failure may retain the
current documented fallback in non-strict planning, but actual build failures
must expose the selected image and relevant recovery command.

Normal rebuild means Docker layer cache remains enabled. The launcher must not
add `--no-cache` or prune images, build cache, volumes, datasets, or models.

## Components and Boundaries

### `run.sh`

Owns terminal interaction, command dispatch, architecture preflight, Compose
build/start, and concise operator output. Menu selection is separated from
platform validation so both behaviors can be tested independently through
non-interactive environment overrides.

### `scripts/detect-runtime.sh`

Owns architecture normalization, L4T and JetPack detection, Jetson image
candidate selection, and Compose-file resolution. It must return shell-safe,
enumerated values only. The launcher must not accept arbitrary mode or Compose
file values through `eval`.

### Docker definitions

`docker-compose.yml` and `Dockerfile` remain the amd64 CUDA path.
`docker-compose.jetson.yml` and `Dockerfile.jetson` remain the aarch64 L4T path.
The Jetson image uses NVIDIA's Jetson PyTorch lineage and `runtime: nvidia`;
desktop CUDA wheels or arbitrary x86 packages must not be copied into it.

### Verification script

A focused script under `scripts/` performs post-start runtime acceptance. Its
quick startup checks verify:

- the API health endpoint;
- the running container image/platform identity;
- PyTorch version and CUDA version;
- `torch.cuda.is_available()` is true;
- CUDA device index 0 has a readable device name.

Its explicit training-smoke mode creates a tiny synthetic YOLO dataset in a
temporary project-local verification directory, selects the smallest available
compatible YOLO training weight, and runs one epoch at a small image size with
`device=0`. It verifies that Ultralytics reports a CUDA device and produces
`best.pt` and `last.pt`. Test artifacts are kept outside user projects and are
removed only when they were created by the verification script.

On Jetson, memory observations use `/proc/meminfo` `MemAvailable` before and
after the bounded smoke run. They are diagnostic evidence, not a fixed pass/fail
threshold: Jetson CPU and GPU share system memory, and a CUDA context can create
a one-time memory waterline. `nvidia-smi` discrete-VRAM fields are not used as
the acceptance criterion.

## Error Handling

- Non-terminal invocation never attempts to read arrow keys.
- Unsupported or mismatched architectures fail before Docker mutation.
- Missing Docker, Compose, L4T, NVIDIA runtime, CUDA, model weights, health
  response, or output artifacts each produce a distinct failure message.
- The training smoke does not download a model implicitly. If no compatible
  local weight exists, it reports the expected `input_model/` path and remains
  unverified rather than converting a network failure into a CUDA diagnosis.
- A Docker-socket permission failure is identified separately because a
  restricted sandbox can hide the host NVIDIA runtime and create a false CPU
  conclusion.
- No fallback changes `device=0` to CPU for Jetson acceptance.

## Testing Strategy

Shell-facing behavior is developed test-first:

- no-argument non-interactive dispatch resolves the saved/native platform;
- menu labels expose exactly the two approved platform names;
- mode aliases map to the correct Compose file;
- real start rejects a host/selection architecture mismatch;
- dry-run planning still permits inspecting both platform plans;
- build/start uses cache-enabled `docker compose ... up -d --build`;
- invalid detector output cannot inject shell commands.

Static checks cover shell syntax and both Compose configurations. Existing
backend and frontend suites guard unrelated behavior in the dirty worktree.

Hardware acceptance runs outside the restricted sandbox on the local Jetson
AGX Orin:

1. verify `aarch64`, L4T R36+, Docker, Compose, and NVIDIA runtime;
2. build and recreate the Jetson service through the new launcher path;
3. verify `/api/health`;
4. probe PyTorch CUDA inside `object-autolabel`;
5. run the bounded one-epoch YOLO CUDA smoke test;
6. confirm `best.pt`, `last.pt`, training device, and `MemAvailable` evidence;
7. inspect service logs for dependency, ABI, OOM, or CUDA errors.

The amd64 path receives plan/config/unit validation on the Jetson host. It is
not claimed as hardware-verified unless an amd64 NVIDIA host is actually
available.

## Documentation and Project Memory

Update `spec/RUNTIME.md`, `spec/OPERATIONS.md`, `spec/TESTING.md`,
`spec/STATUS.md`, and `spec/PROJECT_MAP.md` with:

- the no-argument platform-selector workflow;
- public labels and internal mode mapping;
- architecture mismatch behavior;
- exact quick and training acceptance commands;
- verified and unverified platform scope;
- Jetson CUDA troubleshooting guidance adapted from
  `lesson-20260730-jetson-docker-cuda-troubleshooting.md`.

Add a focused project reference under `spec/references/` recording the observed
host/runtime/image/CUDA/training evidence and the rule that container startup
alone does not prove CUDA training.

## Git Delivery

Preserve all pre-existing worktree changes. Review untracked files and exclude
obvious temporary probes, secrets, caches, generated output, runtime databases,
model weights, and training artifacts. Run full verification before the final
commit. Commit the intended project changes to `main` and push to the existing
`origin` at `https://github.com/a0665x/ObjectAutoLabel`.

