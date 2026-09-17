// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "../api/client";
import type { OpenDataImport, Project } from "../types";
import { OpenDataPage } from "./OpenDataPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("moves source label cards through the center arrows and requires an empty left lane", async () => {
  const labels = ["pedestrian", "people", "bicycle", "car", "van", "truck", "tricycle", "awning-tricycle", "bus", "motor"];
  const mapping = Object.fromEntries(labels.map((label) => [label, label === "bicycle" ? 0 : null]));
  const activeImport: OpenDataImport = {
    id: "import-1", project_id: "project-1", dataset_key: "visdrone2019-det", schema_id: "schema-1",
    version_name: "aerial-v1",
    mapping, sample_percentage: 50, selected_image_count: 10, selected_annotation_count: 20,
    status: "active", created_at: "2026-09-04"
  };
  vi.spyOn(api, "openDataCatalog").mockResolvedValue([{ key: "visdrone2019-det", name: "VisDrone2019-DET", provider: "built_in", source_url: "https://docs.ultralytics.com/datasets/detect/visdrone/", owner: "ultralytics", task: "detect", compatible: true, compatibility_reason: "Ready for bbox mapping.", image_count: 8629, train_count: 6471, val_count: 548, test_count: 1610, labels, downloaded: true, status: "verified", cache_path: "/data/opendata/visdrone2019-det", license: "verify use", format: "visdrone", download_requires_api_key: false }]);
  vi.spyOn(api, "classSchemas").mockResolvedValue([{ id: "schema-1", project_id: "project-1", name: "people-car", classes: [{ class_id: 0, class_name: "people", descriptors: [] }, { class_id: 1, class_name: "car", descriptors: [] }] }]);
  vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(activeImport);
  vi.spyOn(api, "openDataImports").mockResolvedValue([activeImport]);
  vi.spyOn(api, "imageSourceSummary").mockResolvedValue({ images: { project: 12, open_data: 10 }, classes: { project: { people: 4, car: 6 } } });
  const preview = vi.spyOn(api, "previewOpenData").mockResolvedValue({
    dataset_key: "visdrone2019-det", schema_id: "schema-1", schema_name: "people-car", sample_percentage: 50,
    source_image_count: 20, eligible_image_count: 20, excluded_empty_count: 0, selected_image_count: 10,
    selected_annotation_count: 20, selected_by_split: { train: 8, val: 2 }, target_class_counts: { people: 10, car: 10 }, samples: []
  });
  const project: Project = { id: "project-1", name: "demo", description: "", root_path: "/tmp/demo" };
  const deleteHistory = vi.spyOn(api, "deleteHistory").mockResolvedValue({ deleted: { open_data: 1 }, removed_paths: [] });
  vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<OpenDataPage project={project} jobs={[]} refreshJobs={async () => undefined} artifactRevision={0} />);

  expect(await screen.findByText("All source labels assigned")).toBeTruthy();
  fireEvent.click(screen.getByText("bicycle"));
  fireEvent.click(screen.getByRole("button", { name: "Return selected assigned label" }));
  expect(await screen.findByText("1 source labels still require a target or Ignore.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "bicycle" }));
  const peopleTarget = screen.getAllByRole("button").find((button) => button.textContent === "people");
  expect(peopleTarget).toBeTruthy();
  fireEvent.click(peopleTarget!);
  fireEvent.click(screen.getByRole("button", { name: "Assign selected source label" }));
  await waitFor(() => expect(screen.getByText("All source labels assigned")).toBeTruthy());
  expect((screen.getByRole("button", { name: "Validate & Preview" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Validate & Preview" }));
  await screen.findByRole("button", { name: "Reroll Open Data preview" });
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  expect((screen.getByLabelText("Open Data version name") as HTMLInputElement).value).toBe(`OpenData_${mmdd}_v002`);
  const firstSeed = preview.mock.calls[0]?.[1].preview_seed;
  fireEvent.click(screen.getByRole("button", { name: "Reroll Open Data preview" }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(preview.mock.calls[1]?.[1].preview_seed).not.toBe(firstSeed);
  fireEvent.click(screen.getByRole("button", { name: "Delete open data history aerial-v1" }));
  await waitFor(() => expect(deleteHistory).toHaveBeenCalledWith("project-1", "open_data", "import-1"));
});

it("inspects a Platform URL and stops non-detect datasets before download", async () => {
  const builtIn = { key: "visdrone2019-det", name: "VisDrone2019-DET", provider: "built_in" as const, source_url: "https://docs.ultralytics.com/datasets/detect/visdrone/", owner: "ultralytics", task: "detect", compatible: true, compatibility_reason: "Ready for bbox mapping.", image_count: 8629, train_count: 6471, val_count: 548, test_count: 1610, labels: ["car"], downloaded: true, status: "verified", cache_path: "/data/opendata/visdrone2019-det", license: "verify use", format: "visdrone", download_requires_api_key: false };
  const vsai = { ...builtIn, key: "ultralytics:ultralytics:vsai", name: "VSAI", provider: "ultralytics_platform" as const, source_url: "https://platform.ultralytics.com/ultralytics/datasets/vsai", task: "obb", compatible: false, compatibility_reason: "OBB labels are not compatible with this bbox-only workflow.", image_count: 444, train_count: 256, val_count: 73, test_count: 115, labels: ["small-vehicle", "large-vehicle"], downloaded: false, status: "not_downloaded", cache_path: "/data/opendata/ultralytics/ultralytics/vsai", format: "yolo", download_requires_api_key: true };
  vi.spyOn(api, "openDataCatalog").mockResolvedValue([builtIn]);
  vi.spyOn(api, "classSchemas").mockResolvedValue([{ id: "schema-1", project_id: "project-1", name: "vehicles", classes: [{ class_id: 0, class_name: "car", descriptors: ["vehicle"] }] }]);
  vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(null);
  vi.spyOn(api, "openDataImports").mockResolvedValue([]);
  vi.spyOn(api, "imageSourceSummary").mockResolvedValue({ images: { project: 12 }, classes: { project: { car: 6 } } });
  const inspect = vi.spyOn(api, "inspectOpenData").mockResolvedValue(vsai);
  const download = vi.spyOn(api, "downloadOpenData");

  render(<OpenDataPage project={{ id: "project-1", name: "demo", description: "", root_path: "/tmp/demo" }} jobs={[]} refreshJobs={async () => undefined} artifactRevision={0} />);

  expect(await screen.findByLabelText("Official dataset")).toBeTruthy();
  expect(screen.queryByLabelText("Dataset URL")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ultralytics Platform" }));
  expect((screen.getByRole("link", { name: "Browse public Detect datasets" }) as HTMLAnchorElement).href).toBe(
    "https://platform.ultralytics.com/explore"
  );
  fireEvent.change(screen.getByLabelText("Dataset URL"), { target: { value: vsai.source_url } });
  fireEvent.click(screen.getByRole("button", { name: "Inspect dataset" }));
  expect(await screen.findByText(/OBB labels are not compatible/)).toBeTruthy();
  expect(inspect).toHaveBeenCalledWith(vsai.source_url);
  expect((screen.getByRole("button", { name: "Download to shared cache" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText(/Ultralytics API key/)).toBeNull();
  expect(download).not.toHaveBeenCalled();
});
