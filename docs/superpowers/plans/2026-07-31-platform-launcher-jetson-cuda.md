# Platform Launcher and Jetson CUDA Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a safe two-platform first-install launcher, non-building reboot startup, explicit cached rebuild, and evidence that the Jetson container can train a tiny YOLO model with CUDA.

**Architecture:** Keep `desktop` and `jetson` as internal runtime modes while presenting `x86_64 / amd64` and `Jetson / aarch64` to operators. `run.sh` owns lifecycle dispatch and uses an allowlisted parser for detector output; a separate verification script owns health, CUDA, and bounded YOLO training acceptance. Existing Dockerfiles and Compose files remain platform-specific.

**Tech Stack:** Bash 4+, Docker Compose v2/v5 CLI, pytest, FastAPI health endpoint, NVIDIA Jetson PyTorch, Ultralytics YOLO.

## Global Constraints

- All terminal menu labels, prompts, status messages, warnings, and errors are English.
- Bare `./run.sh` builds and starts only when the selected local image is absent.
- Bare `./run.sh` does not mutate Docker state when the selected image already exists.
- `./run.sh --up` and `./run.sh --down_up` never build.
- `./run.sh --rebuild` uses Docker layer cache and then starts the service.
- Actual build/start rejects host and selected-platform architecture mismatches; `--plan` permits both modes.
- Jetson acceptance requires CUDA and never falls back to CPU.
- Do not prune Docker data, remove named volumes, delete models, or use `--no-cache`.
- Preserve unrelated pre-existing worktree changes.

---

### Task 1: Testable runtime command harness

**Files:**
- Modify: `tests/backend/test_runtime_scripts.py`

**Interfaces:**
- Consumes: repository-root `run.sh`.
- Produces: `run_command(*args, env=None)` and `make_fake_docker(tmp_path, log_path, image_exists)` test helpers used by later launcher tests.

- [ ] **Step 1: Extend the test harness without changing production behavior**

Add environment-aware command execution and a fake `docker` executable:

```python
import os


def run_command(
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.update(env or {})
    return subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=command_env,
    )


def make_fake_docker(tmp_path: Path, *, image_exists: bool) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "docker.log"
    image_status = "0" if image_exists else "1"
    docker = bin_dir / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"${FAKE_DOCKER_LOG}\"\n"
        "if [[ \"$1 $2\" == 'image inspect' ]]; then\n"
        f"  if [[ '{image_status}' == '0' ]]; then\n"
        "    printf 'sha256:test 2026-07-31T00:00:00Z\\n'\n"
        "    exit 0\n"
        "  fi\n"
        "  exit 1\n"
        "fi\n"
        "if [[ \"$1\" == 'info' ]]; then\n"
        "  printf '{\"nvidia\": {}}\\n'\n"
        "  exit 0\n"
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return bin_dir, log_path
```

- [ ] **Step 2: Run the existing runtime tests**

Run:

```bash
pytest -q tests/backend/test_runtime_scripts.py
```

Expected: the two existing `--plan` tests pass.

- [ ] **Step 3: Commit the isolated test-harness change**

```bash
git add tests/backend/test_runtime_scripts.py
git commit -m "test: add runtime launcher command harness"
```

### Task 2: First-install, startup, and rebuild lifecycle

**Files:**
- Modify: `tests/backend/test_runtime_scripts.py`
- Modify: `run.sh`

**Interfaces:**
- Consumes: `scripts/detect-runtime.sh env MODE`, images `object-autolabel:latest` and `object-autolabel:jetson`.
- Produces: `./run.sh`, `--up`, `--rebuild`, and non-building `--down_up`.

- [ ] **Step 1: Write failing launcher lifecycle tests**

Add focused tests using `OBJECT_AUTOLABEL_MODE=jetson`, fake Docker, and a
`PATH` composed from the temporary fake-bin directory followed by
`os.environ["PATH"]`:

```python
def runtime_env(bin_dir: Path, log_path: Path) -> dict[str, str]:
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_DOCKER_LOG": str(log_path),
        "OBJECT_AUTOLABEL_MODE": "jetson",
        "OBJECT_AUTOLABEL_SKIP_VERIFY": "1",
    }


def test_help_uses_public_platform_labels_and_english_commands() -> None:
    result = run_command("./run.sh", "--help")
    assert result.returncode == 0
    assert "x86_64 / amd64" in result.stdout
    assert "Jetson / aarch64" in result.stdout
    assert "--rebuild" in result.stdout


def test_bare_launcher_with_existing_image_only_prints_guidance(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    result = run_command("./run.sh", env=runtime_env(bin_dir, log_path))
    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "Existing image:" in result.stdout
    assert "./run.sh --up" in result.stdout
    assert "./run.sh --rebuild" in result.stdout
    assert "compose" not in calls


def test_bare_launcher_builds_and_starts_when_image_is_missing(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=False)
    result = run_command("./run.sh", env=runtime_env(bin_dir, log_path))
    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "compose" in calls
    assert "up -d --build" in calls
    assert "--no-cache" not in calls


def test_up_uses_existing_image_without_build(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    result = run_command(
        "./run.sh", "--up", env=runtime_env(bin_dir, log_path)
    )
    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "up -d --no-build" in calls
    assert "--build" not in calls


def test_up_fails_with_install_guidance_when_image_is_missing(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=False)
    result = run_command(
        "./run.sh", "--up", env=runtime_env(bin_dir, log_path)
    )
    assert result.returncode != 0
    assert "Run ./run.sh for first installation." in result.stderr


def test_rebuild_uses_cache_and_starts(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    result = run_command(
        "./run.sh", "--rebuild", env=runtime_env(bin_dir, log_path)
    )
    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "up -d --build" in calls
    assert "--no-cache" not in calls


def test_down_up_recreates_without_build(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    result = run_command(
        "./run.sh", "--down_up", env=runtime_env(bin_dir, log_path)
    )
    calls = log_path.read_text(encoding="utf-8")
    assert "down" in calls
    assert "up -d --no-build" in calls
    assert "--build" not in calls
```

- [ ] **Step 2: Run the tests and verify the expected failures**

Run:

```bash
pytest -q tests/backend/test_runtime_scripts.py
```

Expected: failures show missing `--rebuild`, bare invocation printing usage, and
`--up`/`--down_up` still including `--build`.

- [ ] **Step 3: Implement the minimal lifecycle split**

In `run.sh`:

- change the visible option array to `("desktop" "jetson")`;
- render `x86_64 / amd64` and `Jetson / aarch64`;
- let no arguments call `first_install`;
- add `image_for_mode`, `image_exists`, and `print_existing_image`;
- make `--up` require an existing image and call `up -d --no-build`;
- add `--rebuild` calling `up -d --build`;
- make `--down_up` call `down` then `up -d --no-build`;
- call post-start verification unless `OBJECT_AUTOLABEL_SKIP_VERIFY=1`.

The dispatch must have these effective commands:

```bash
first_install() {
  local mode="$1"
  local image
  image="$(image_for_mode "${mode}")"
  if docker image inspect \
      --format '{{.Id}} {{.Created}}' "${image}" >/dev/null 2>&1; then
    echo "Existing image: $(docker image inspect --format '{{.Id}} {{.Created}}' "${image}")"
    echo "Run ./run.sh --up for normal startup."
    echo "Run ./run.sh --rebuild after source or dependency changes."
    return
  fi
  compose "${mode}" up -d --build
  verify_started_runtime "${mode}"
}
```

`--up` must not silently build:

```bash
require_image "${MODE}"
compose "${MODE}" up -d --no-build
verify_started_runtime "${MODE}"
```

- [ ] **Step 4: Run focused and shell-syntax verification**

Run:

```bash
pytest -q tests/backend/test_runtime_scripts.py
bash -n run.sh
```

Expected: all runtime-script tests pass and shell syntax exits 0.

- [ ] **Step 5: Commit the lifecycle behavior**

```bash
git add run.sh tests/backend/test_runtime_scripts.py
git commit -m "feat: separate runtime install start and rebuild"
```

### Task 3: Architecture preflight and safe detector parsing

**Files:**
- Modify: `tests/backend/test_runtime_scripts.py`
- Modify: `run.sh`
- Modify: `scripts/detect-runtime.sh`

**Interfaces:**
- Consumes: allowlisted detector keys.
- Produces: `load_runtime MODE`, `validate_platform MODE`, and safe dry-run planning.

- [ ] **Step 1: Write failing safety tests**

Add fake `uname` support to the test bin and these behaviors:

```python
def test_real_start_rejects_mismatched_platform(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    uname = bin_dir / "uname"
    uname.write_text("#!/usr/bin/env bash\nprintf 'x86_64\\n'\n", encoding="utf-8")
    uname.chmod(0o755)
    env = runtime_env(bin_dir, log_path)
    env["OBJECT_AUTOLABEL_MODE"] = "jetson"
    result = run_command("./run.sh", "--up", env=env)
    assert result.returncode != 0
    assert "Selected platform Jetson / aarch64 does not match host x86_64." in result.stderr


def test_plan_allows_inspecting_non_native_platform(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)
    uname = bin_dir / "uname"
    uname.write_text("#!/usr/bin/env bash\nprintf 'x86_64\\n'\n", encoding="utf-8")
    uname.chmod(0o755)
    result = run_command(
        "./run.sh", "--plan", "jetson", env=runtime_env(bin_dir, log_path)
    )
    assert result.returncode == 0
    assert "docker-compose.jetson.yml" in result.stdout


def test_detector_rejects_unknown_output_keys(tmp_path: Path) -> None:
    fake_detector = tmp_path / "detect-runtime.sh"
    marker = tmp_path / "injected"
    fake_detector.write_text(
        "#!/usr/bin/env bash\n"
        f"printf 'EVIL=$(touch {marker})\\n'\n",
        encoding="utf-8",
    )
    fake_detector.chmod(0o755)
    result = run_command(
        "./run.sh",
        "--plan",
        "jetson",
        env={"OBJECT_AUTOLABEL_DETECT_SCRIPT": str(fake_detector)},
    )
    assert result.returncode != 0
    assert not marker.exists()
```

- [ ] **Step 2: Verify red**

Run:

```bash
pytest -q tests/backend/test_runtime_scripts.py
```

Expected: mismatch is not rejected and the detector injection test demonstrates
the unsafe `eval` path.

- [ ] **Step 3: Replace `eval` with an allowlisted parser**

Permit the detector path override only for tests, parse `KEY=VALUE` lines, and
assign only these keys:

```bash
load_runtime() {
  local mode="$1"
  local key value
  while IFS='=' read -r key value; do
    case "${key}" in
      OBJECT_AUTOLABEL_MODE) OBJECT_AUTOLABEL_MODE="${value}" ;;
      OBJECT_AUTOLABEL_ARCH) OBJECT_AUTOLABEL_ARCH="${value}" ;;
      OBJECT_AUTOLABEL_L4T) OBJECT_AUTOLABEL_L4T="${value}" ;;
      OBJECT_AUTOLABEL_JETPACK) OBJECT_AUTOLABEL_JETPACK="${value}" ;;
      JETSON_BASE_IMAGE) JETSON_BASE_IMAGE="${value}" ;;
      COMPOSE_FILE) COMPOSE_FILE="${value}" ;;
      "") ;;
      *) echo "Unexpected runtime detector key: ${key}" >&2; return 2 ;;
    esac
  done < <("${DETECT_SCRIPT}" env "${mode}")
}
```

Validate the resolved mode, normalized architecture, and Compose file against
fixed project paths before invoking Docker. Add an `OBJECT_AUTOLABEL_DETECT_SCRIPT`
override at initialization without allowing detector output to select arbitrary
commands.

- [ ] **Step 4: Add host/platform validation**

Implement `validate_platform` using the actual host `uname -m` and call it from
install, `--up`, `--rebuild`, and `--down_up`, but not `--plan`.

For Jetson, require non-unknown L4T before a real Docker mutation. Check the
NVIDIA runtime through:

```bash
docker info --format '{{json .Runtimes}}'
```

and require the returned text to contain `nvidia`.

- [ ] **Step 5: Verify green**

Run:

```bash
pytest -q tests/backend/test_runtime_scripts.py
bash -n run.sh scripts/detect-runtime.sh
```

Expected: all tests pass; injection marker is absent.

- [ ] **Step 6: Commit runtime safety**

```bash
git add run.sh scripts/detect-runtime.sh tests/backend/test_runtime_scripts.py
git commit -m "fix: validate platform runtime before Docker startup"
```

### Task 4: CUDA and bounded YOLO training acceptance

**Files:**
- Create: `scripts/verify-runtime.sh`
- Create: `tests/backend/test_verify_runtime_script.py`
- Modify: `run.sh`

**Interfaces:**
- Consumes: running `object-autolabel` container, `/api/health`, mounted `/app/input_model`.
- Produces: `scripts/verify-runtime.sh --quick MODE` and `scripts/verify-runtime.sh --train MODE`.

- [ ] **Step 1: Write failing verification-script tests**

Use a fake `curl` that returns `{"ok":true}` and fake Docker output. Assert:

```python
def test_quick_verification_requires_cuda(tmp_path: Path) -> None:
    result = run_verify_with_fakes(
        tmp_path,
        docker_exec_output="2.8.0 12.6 False Orin",
        *("--quick", "jetson"),
    )
    assert result.returncode != 0
    assert "CUDA is not available inside object-autolabel." in result.stderr


def test_quick_verification_reports_health_and_device(tmp_path: Path) -> None:
    result = run_verify_with_fakes(
        tmp_path,
        docker_exec_output="2.8.0 12.6 True Orin",
        *("--quick", "jetson"),
    )
    assert result.returncode == 0
    assert "API health: OK" in result.stdout
    assert "CUDA device: Orin" in result.stdout


def test_train_verification_never_uses_cpu(tmp_path: Path) -> None:
    result, calls = run_train_verify_with_fakes(tmp_path)
    assert result.returncode == 0
    assert "device=0" in calls
    assert "device=cpu" not in calls
    assert "best.pt: OK" in result.stdout
    assert "last.pt: OK" in result.stdout
```

- [ ] **Step 2: Verify red**

Run:

```bash
pytest -q tests/backend/test_verify_runtime_script.py
```

Expected: collection/execution fails because `scripts/verify-runtime.sh` does
not exist.

- [ ] **Step 3: Implement quick acceptance**

Create an English-only Bash script with:

```bash
usage: scripts/verify-runtime.sh --quick MODE | --train MODE
```

`--quick` retries `curl -fsS http://127.0.0.1:8501/api/health`, inspects the
running image, then runs this container probe:

```python
import torch
available = torch.cuda.is_available()
name = torch.cuda.get_device_name(0) if available else "unavailable"
print(torch.__version__, torch.version.cuda, available, name)
raise SystemExit(0 if available else 3)
```

Do not convert a failed CUDA probe to a warning.

- [ ] **Step 4: Implement the bounded train acceptance**

Before training, select the smallest readable `/app/input_model/*.pt` inside
the container. Record host `MemAvailable` on Jetson. Feed a Python program to
`docker exec -i object-autolabel python3 -` that:

```python
from pathlib import Path
from PIL import Image, ImageDraw
import shutil
from ultralytics import YOLO

root = Path("/tmp/object-autolabel-yolo-cuda-smoke")
if root.exists():
    shutil.rmtree(root)
for split in ("train", "val"):
    (root / "images" / split).mkdir(parents=True)
    (root / "labels" / split).mkdir(parents=True)
    image = Image.new("RGB", (64, 64), "black")
    ImageDraw.Draw(image).rectangle((20, 20, 44, 44), fill="white")
    image.save(root / "images" / split / "sample.jpg")
    (root / "labels" / split / "sample.txt").write_text(
        "0 0.5 0.5 0.375 0.375\n", encoding="utf-8"
    )

(root / "dataset.yaml").write_text(
    f"path: {root}\ntrain: images/train\nval: images/val\n"
    "names:\n  0: square\n",
    encoding="utf-8",
)
model = YOLO(SMALLEST_LOCAL_WEIGHT)
result = model.train(
    data=str(root / "dataset.yaml"),
    epochs=1,
    imgsz=64,
    batch=1,
    workers=0,
    device=0,
    project=str(root / "runs"),
    name="cuda-smoke",
    exist_ok=True,
    plots=False,
    verbose=False,
)
weights = Path(result.save_dir) / "weights"
assert (weights / "best.pt").is_file()
assert (weights / "last.pt").is_file()
print(f"save_dir={result.save_dir}")
print("best.pt: OK")
print("last.pt: OK")
shutil.rmtree(root)
```

Pass the selected model path through an allowlisted environment variable to
the Python process. The script must never download weights and must fail with
`Place a compatible .pt model in input_model/.` when none exists.

- [ ] **Step 5: Wire quick verification into successful starts**

In `run.sh`, call:

```bash
"${PROJECT_DIR}/scripts/verify-runtime.sh" --quick "${mode}"
```

after first install, `--up`, `--rebuild`, and `--down_up`, unless the test-only
`OBJECT_AUTOLABEL_SKIP_VERIFY=1` is set.

- [ ] **Step 6: Verify green**

Run:

```bash
pytest -q tests/backend/test_verify_runtime_script.py
pytest -q tests/backend/test_runtime_scripts.py
bash -n run.sh scripts/detect-runtime.sh scripts/verify-runtime.sh
```

Expected: all tests pass and shell syntax exits 0.

- [ ] **Step 7: Commit verification behavior**

```bash
git add run.sh scripts/verify-runtime.sh tests/backend/test_verify_runtime_script.py
git commit -m "feat: verify container CUDA and YOLO training"
```

### Task 5: Operator and durable project documentation

**Files:**
- Modify: `README.md`
- Modify: `spec/PROJECT_MAP.md`
- Modify: `spec/RUNTIME.md`
- Modify: `spec/OPERATIONS.md`
- Modify: `spec/TESTING.md`

**Interfaces:**
- Consumes: implemented command behavior from Tasks 2–4.
- Produces: first-install/reboot/rebuild instructions and documented verification commands.

- [ ] **Step 1: Update README startup paths**

Lead the Start section with:

```markdown
### First installation

Run `./run.sh`, choose `x86_64 / amd64` or `Jetson / aarch64`, and press Enter.
If the selected image already exists, the launcher does not rebuild or start it.

### Normal startup after a reboot

Run `./run.sh --up`. This command uses the existing image and never rebuilds it.

### Rebuild after code or dependency changes

Run `./run.sh --rebuild`. This command keeps Docker layer cache enabled, rebuilds
the selected platform image, and starts it.
```

Document `--down_up` as container recreation without image rebuild. Replace the
old direct Compose rebuild example with the launcher command.

- [ ] **Step 2: Update runtime and operations specs**

Document exact public labels, internal mappings, image-exists behavior,
architecture mismatch failures, and:

```bash
scripts/verify-runtime.sh --quick jetson
scripts/verify-runtime.sh --train jetson
```

- [ ] **Step 3: Update testing guidance**

Document the automated launcher tests and the two runtime acceptance levels.
Adapt these generally applicable rules from the supplied 2026-07-30 lesson:

- restricted sandboxes can hide `/var/run/docker.sock` and NVIDIA runtime;
- Jetson requires the L4T/NVIDIA PyTorch image lineage;
- `torch.cuda.is_available()` must be checked in the real container;
- Jetson memory evidence uses `/proc/meminfo` `MemAvailable`;
- image/container health alone does not prove CUDA training;
- real acceptance requires a bounded YOLO train with output weights;
- no CPU fallback is acceptable for Jetson verification.

- [ ] **Step 4: Update the project map**

Add the platform lifecycle and runtime-verification scripts to the relevant
`spec/PROJECT_MAP.md` change guide entry. Do not add hardware-result claims yet.

- [ ] **Step 5: Verify documentation**

Run:

```bash
rg -n "./run.sh( |`)|--up|--rebuild|--down_up|verify-runtime" \
  README.md spec/PROJECT_MAP.md spec/RUNTIME.md spec/OPERATIONS.md \
  spec/TESTING.md
git diff --check
```

Expected: all three lifecycle paths and both verification modes are present;
`git diff --check` exits 0.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md spec/PROJECT_MAP.md spec/RUNTIME.md spec/OPERATIONS.md \
  spec/TESTING.md
git commit -m "docs: explain platform lifecycle and Jetson CUDA checks"
```

### Task 6: Jetson AGX Orin hardware acceptance

**Files:**
- Modify: `spec/PROJECT_MAP.md`
- Modify: `spec/RUNTIME.md`
- Modify: `spec/STATUS.md`
- Create: `spec/references/lesson-20260731-jetson-docker-cuda-training.md`

**Interfaces:**
- Consumes: local Jetson host, Docker daemon, NVIDIA runtime, local `input_model/yolo11n.pt`.
- Produces: fresh build/start/health/CUDA/train evidence.

- [ ] **Step 1: Verify the host outside the restricted sandbox**

Run:

```bash
uname -m
head -1 /etc/nv_tegra_release
docker info --format '{{json .Runtimes}}'
./run.sh --detect jetson
```

Expected: `aarch64`, L4T R36.4.x, Docker runtimes containing `nvidia`, and
Jetson mode selecting `docker-compose.jetson.yml`.

- [ ] **Step 2: Validate Compose definitions**

Run:

```bash
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

Expected: both exit 0.

- [ ] **Step 3: Rebuild and start the Jetson image**

Run:

```bash
OBJECT_AUTOLABEL_MODE=jetson ./run.sh --rebuild
```

Expected: cached build succeeds, `object-autolabel:jetson` starts, and quick
health/CUDA verification passes.

- [ ] **Step 4: Run direct runtime probes**

Run:

```bash
curl -fsS http://127.0.0.1:8501/api/health
docker inspect --format '{{.Config.Image}} {{.State.Status}}' object-autolabel
docker exec object-autolabel python3 -c \
  "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Expected: health JSON contains `"ok":true`, image is
`object-autolabel:jetson`, state is `running`, CUDA availability is `True`, and
device name identifies Orin.

- [ ] **Step 5: Run the bounded YOLO CUDA train**

Run:

```bash
scripts/verify-runtime.sh --train jetson
```

Expected: exit 0, `device=0`, and `best.pt: OK` plus `last.pt: OK`. Capture the
before/after `MemAvailable` lines in the project lesson.

- [ ] **Step 6: Inspect logs and container state**

Run:

```bash
docker logs --tail 200 object-autolabel
docker ps --filter name=object-autolabel
```

Expected: no CUDA, ABI, OOM, dependency, or restart-loop errors; container
remains running.

- [ ] **Step 7: Preserve the verified Jetson evidence**

Create `spec/references/lesson-20260731-jetson-docker-cuda-training.md` using
the actual outputs from Steps 1–6. Include:

- host architecture and complete first L4T release line;
- selected Compose file, Jetson base image, built image id and creation time;
- PyTorch version, CUDA version, availability, and device name;
- health response;
- training model path, `save_dir`, `best.pt`, and `last.pt` result;
- before/after `/proc/meminfo` `MemAvailable`;
- relevant negative log inspection;
- the explicit statement that amd64 hardware startup was not verified on the
  aarch64 host.

Link the lesson from `spec/PROJECT_MAP.md` and `spec/RUNTIME.md`. Update
`spec/STATUS.md` with date `2026-07-31` and only fresh results from this run.

- [ ] **Step 8: Verify and commit the evidence**

Run:

```bash
rg -n "aarch64|L4T|PyTorch|CUDA|MemAvailable|best.pt|last.pt|amd64" \
  spec/references/lesson-20260731-jetson-docker-cuda-training.md \
  spec/STATUS.md
git diff --check
git add spec/PROJECT_MAP.md spec/RUNTIME.md spec/STATUS.md \
  spec/references/lesson-20260731-jetson-docker-cuda-training.md
git commit -m "docs: record Jetson CUDA training acceptance"
```

Expected: evidence fields contain actual command results, the diff check exits
0, and the documentation commit succeeds.

### Task 7: Full regression verification and GitHub delivery

**Files:**
- Review all tracked/untracked workspace changes.

**Interfaces:**
- Consumes: all implementation, pre-existing user changes, and repository tests.
- Produces: reviewed commits pushed to `origin/main`.

- [ ] **Step 1: Review scope and exclude artifacts**

Run:

```bash
git status --short
git diff --stat
git diff --check
git ls-files --others --exclude-standard
```

Inspect `.codex-forward-test.txt`, runtime databases, generated frontend output,
model weights, temporary smoke files, caches, secrets, and large binary files.
Do not add them merely because they are untracked.

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run build
bash -n run.sh scripts/detect-runtime.sh scripts/verify-runtime.sh
python3 -m py_compile backend/app/main.py backend/app/repositories.py \
  backend/app/project_services.py backend/app/server.py
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

Expected: every command exits 0 with no test failures or build errors.

- [ ] **Step 3: Re-run final runtime evidence**

Run:

```bash
./run.sh --status
curl -fsS http://127.0.0.1:8501/api/health
scripts/verify-runtime.sh --quick jetson
```

Expected: the container is running, API health is OK, and CUDA probe passes.

- [ ] **Step 4: Commit remaining intended worktree changes**

Stage only reviewed source, tests, docs, and configuration:

```bash
git add -u
git add backend/app/server.py \
  docs/superpowers/plans/2026-07-03-model-convert-packages.md \
  docs/superpowers/specs/2026-07-03-model-convert-packages-design.md \
  docs/superpowers/specs/2026-07-03-project-artifact-context-design.md \
  frontend/components.json \
  frontend/src/App.test.tsx \
  memory \
  skills-lock.json \
  spec/STATUS.md \
  spec/references/lesson-20260731-jetson-docker-cuda-training.md \
  tests/backend/test_artifact_context.py \
  tests/backend/test_chain_versions.py \
  tests/backend/test_dataset_flow_updates.py \
  tests/backend/test_model_conversion_api.py \
  tests/backend/test_model_conversion_packages.py \
  tests/backend/test_model_conversion_services.py \
  tests/backend/test_pseudo_lineage.py \
  tests/backend/test_runtime_scripts.py \
  tests/backend/test_verify_runtime_script.py \
  tests/backend/test_world_models_merge.py \
  tests/conftest.py
git diff --cached --stat
git diff --cached --check
git commit -m "feat: complete ObjectAutoLabel workflow updates"
```

If the intended changes naturally divide into coherent existing feature sets,
use separate descriptive commits instead of one catch-all commit.

- [ ] **Step 5: Verify the exact commit to publish**

Run:

```bash
git status --short --branch
git log --oneline --decorate origin/main..main
git diff --stat origin/main..main
```

Expected: only explicitly reviewed untracked artifacts remain; intended commits
are ahead of `origin/main`.

- [ ] **Step 6: Push main**

Run:

```bash
git push origin main
```

Expected: GitHub accepts the update and local `main` matches `origin/main`.

- [ ] **Step 7: Confirm remote state**

Run:

```bash
git status --short --branch
git log -1 --oneline --decorate
```

Expected: branch reports no ahead count and the latest intended commit is
decorated with both `main` and `origin/main`.
