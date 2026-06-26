const toast = document.querySelector("#toast");
const jobsList = document.querySelector("#jobsList");
let activeJobPoll = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 4200);
}

function valueForField(field) {
  if (field.type === "checkbox") return field.checked;
  if (field.type === "number") return field.value === "" ? null : Number(field.value);
  return field.value;
}

function payloadFromForm(form) {
  const data = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    data[field.name] = valueForField(field);
  }
  if (form.dataset.transform === "classes") {
    data.classes = JSON.parse(data.classes_json || "{}");
    delete data.classes_json;
  }
  if (form.dataset.transform === "train") {
    data.classes = data.classes_csv.split(",").map((item) => item.trim()).filter(Boolean);
    delete data.classes_csv;
    if (!data.test) data.test = null;
  }
  return data;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsList.innerHTML = '<p class="hint">No jobs yet.</p>';
    return;
  }
  jobsList.innerHTML = jobs.map((job) => `
    <article class="job">
      <strong>${job.name} · ${job.status}</strong>
      <small>${job.message || ""}</small>
      <progress max="100" value="${job.progress || 0}"></progress>
      <small>${job.id}</small>
    </article>
  `).join("");
}

async function refreshJobs() {
  const jobs = await api("/api/jobs");
  renderJobs(jobs);
}

async function pollJob(jobId) {
  window.clearInterval(activeJobPoll);
  activeJobPoll = window.setInterval(async () => {
    const job = await api(`/api/jobs/${jobId}`);
    await refreshJobs();
    if (["completed", "failed"].includes(job.status)) {
      window.clearInterval(activeJobPoll);
      showToast(job.status === "completed" ? `${job.name} completed` : `${job.name} failed: ${job.message}`);
    }
  }, 1400);
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.panel}`).classList.add("active");
  });
});

document.querySelectorAll("form[data-action]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const job = await api(form.dataset.action, {
        method: "POST",
        body: JSON.stringify(payloadFromForm(form)),
      });
      showToast(`Job queued: ${job.name}`);
      await refreshJobs();
      await pollJob(job.id);
    } catch (error) {
      showToast(error.message);
    }
  });
});

document.querySelector("#refreshJobs").addEventListener("click", refreshJobs);

async function boot() {
  try {
    const health = await api("/api/health");
    document.querySelector(".status-dot").classList.add("ok");
    document.querySelector("#apiStatus").textContent = "API online";
    document.querySelector("#apiRoot").textContent = health.project_root;

    const models = await api("/api/models");
    fillSelect("#worldModels", models.world_models, "yolov8m-world.pt");
    fillSelect("#trainModels", models.training_models, "yolov8n.pt");
    await refreshJobs();
  } catch (error) {
    document.querySelector("#apiStatus").textContent = "API offline";
    showToast(error.message);
  }
}

function fillSelect(selector, values, fallback) {
  const select = document.querySelector(selector);
  const options = values.length ? values : [fallback];
  select.innerHTML = options.map((value) => `<option>${value}</option>`).join("");
  if (options.includes(fallback)) select.value = fallback;
}

boot();
