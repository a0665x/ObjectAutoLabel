# ObjectAutoLabel

ObjectAutoLabel prepares object-detection datasets and operates YOLO models through one project-centered workflow. Detailed architecture and implementation routing live in [spec/PROJECT_MAP.md](spec/PROJECT_MAP.md).

## Language

**Project package**:
The complete, independently removable workspace for one labeling and model-development effort.
_Avoid_: Project folder, experiment folder

**Source asset**:
An image collection or video registered as input to a project package.
_Avoid_: Dataset, upload

**Class schema**:
The canonical class identities, names, and prompt descriptors used by one project package.
_Avoid_: Label list, prompt list

**Pseudo build**:
A named set of model-generated candidate annotations with recorded model and schema provenance.
_Avoid_: Auto labels, latest labels

**Review workbench**:
The human quality-control surface for inspecting and correcting candidate annotations.
_Avoid_: Preview page, label screen

**Augment build**:
A named transformed or pass-through image set derived from an upstream annotation build.
_Avoid_: Augmented folder, copies

**Split build**:
A named train/validation/test partition with explicit upstream lineage.
_Avoid_: Dataset YAML, split folder

**Training run**:
A named model-training attempt bound to one split build and one input model.
_Avoid_: Train job, experiment

**Model source**:
A native model checkpoint eligible for validation or conversion.
_Avoid_: Output model

**Conversion package**:
A native checkpoint plus selected deployment artifacts and the class metadata needed to interpret them.
_Avoid_: Exported model

**Build lineage**:
The recorded dependency chain connecting source, annotations, augmentation, split, and training outputs.
_Avoid_: Latest state, current data

**History deletion cascade**:
An operator-confirmed removal of one saved build/run and every downstream history record and project-owned artifact that depends on it. Shared Open Data caches, raw input, source assets, and class schemas are outside this cascade.
_Avoid_: Orphan cleanup, delete one row

**Outdated build**:
An existing materialized build whose recorded upstream inputs no longer match active project data.
_Avoid_: Broken build, deleted build

**Shared Open Data cache**:
A reusable, verified upstream dataset kept independently from every project package.
_Avoid_: Project Open Data, downloaded project data

**Open Data import**:
One named, project-owned version of mapped and sampled records derived from a shared Open Data cache. The newest version is active in Review; every retained version remains selectable by Split.
_Avoid_: Shared dataset, pseudo build

**Current Split**:
The newest Split version, selected by default for training. It is not the only trainable version.
_Avoid_: Only valid split, selected split

**Saved Split version**:
An immutable train/validation/test dataset snapshot identified by its Pseudo, Augment, optional Open Data lineage, and total image count. Any non-outdated version may be selected for training.
_Avoid_: Historical split, old split

**Stale project record**:
A database project entry whose expected project-owned storage is missing.
_Avoid_: Empty project, deleted project

**Stream Demo**:
A live inference session using one conversion package's native or converted model,
a host camera or uploaded video, and an annotated GStreamer video stream.

**CLI workspace**:
A shared Python utility workspace and trusted-operator terminal sheets using
the same Docker runtime as Stream Demo.
_Avoid_: Sandbox, host Python environment
