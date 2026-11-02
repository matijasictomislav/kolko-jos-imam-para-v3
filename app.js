const STORAGE_KEY = "kolko_jos_imam_para_v5";
const BACKUP_KEY = "kolko_jos_imam_para_v5_backup";
const OLD_KEYS_TO_PURGE = [
  "kolko_jos_imam_para_v1",
  "kolko_jos_imam_para_v2",
  "kolko_jos_imam_para_v3",
  "kolko_jos_imam_para_v3_backup",
  "kolko_jos_imam_para_v4",
  "kolko_jos_imam_para_v4_backup"
];

// Očisti stare testne ključeve iz prijašnjih verzija kako bi aplikacija krenula potpuno prazna
try {
  OLD_KEYS_TO_PURGE.forEach(k => localStorage.removeItem(k));
} catch (e) {}

// Zatraži trajnu pohranu kako mobilni preglednik ne bi sam brisao localStorage
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatCurrentDateTimeHR() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year}. ${hours}:${mins}`;
}

function parseLocalDate(isoStr) {
  if (!isoStr || typeof isoStr !== "string") return null;
  const parts = isoStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateHR(isoStr) {
  const d = parseLocalDate(isoStr);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}.`;
}

function formatEUR(val) {
  const num = Number(val) || 0;
  return (
    num.toLocaleString("hr-HR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + " €"
  );
}

// Provjera je li razdoblje završeno ili mu je prošao završni datum
function isPeriodLocked(period) {
  if (!period) return false;
  if (period.completed === true) return true;
  if (period.endDate) {
    const end = parseLocalDate(period.endDate);
    const today = parseLocalDate(getTodayISO());
    if (end && today && end < today) {
      return true;
    }
  }
  return false;
}

function sanitizeState(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const periods = Array.isArray(parsed.periods) ? parsed.periods : [];
  const cleanPeriods = periods
    .filter(p => p && typeof p === "object")
    .map(p => ({
      id: String(p.id || "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)),
      name: String(p.name || "Razdoblje"),
      initialBudget: Math.max(0, Number(p.initialBudget) || 0),
      startDate: String(p.startDate || ""),
      endDate: String(p.endDate || ""),
      completed: Boolean(p.completed),
      categories: Array.isArray(p.categories)
        ? p.categories
            .filter(c => c && typeof c === "object")
            .map(c => ({
              id: String(c.id || "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)),
              name: String(c.name || "Kategorija"),
              limit: Math.max(0, Number(c.limit) || 0),
              expenses: Array.isArray(c.expenses)
                ? c.expenses
                    .filter(e => e && typeof e === "object")
                    .map((e, idx) => ({
                      id: String(e.id || "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)),
                      title: String(e.title || "Trošak"),
                      amount: Math.max(0, Number(e.amount) || 0),
                      date: String(e.date || ""),
                      createdAt: Number(e.createdAt) || Date.now() - idx
                    }))
                : []
            }))
        : []
    }));

  let activeId = parsed.activePeriodId || null;
  if (cleanPeriods.length === 0) {
    activeId = null;
  } else if (!cleanPeriods.some(p => p.id === activeId)) {
    activeId = cleanPeriods[cleanPeriods.length - 1].id;
  }

  return {
    activePeriodId: activeId,
    sortOrder: parsed.sortOrder || "default",
    periods: cleanPeriods
  };
}

function loadState() {
  const keysToTry = [STORAGE_KEY, BACKUP_KEY];
  for (const key of keysToTry) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const clean = sanitizeState(JSON.parse(raw));
        if (clean) return clean;
      }
    } catch (e) {}
  }
  // Potpuno prazno početno stanje
  return {
    activePeriodId: null,
    sortOrder: "default",
    periods: []
  };
}

let state = loadState();
let activeInlineEdit = null; // { type: 'cat' | 'expense', catId, expId }
let isCreatingNewPeriod = false;
let pendingConfirmAction = null;

function saveState() {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(BACKUP_KEY, serialized);
  } catch (e) {
    console.error("Greška pri spremanju podataka:", e);
  }
}

function getActivePeriod() {
  if (!state.periods || state.periods.length === 0) return null;
  let p = state.periods.find(item => item.id === state.activePeriodId);
  if (!p) {
    p = state.periods[state.periods.length - 1];
    state.activePeriodId = p.id;
  }
  return p;
}

function calculatePeriodMetrics(period) {
  const initial = Number(period.initialBudget) || 0;
  let totalSpent = 0;
  let effectiveAllocatedOrSpent = 0;

  (period.categories || []).forEach(cat => {
    const limit = Number(cat.limit) || 0;
    const catSpent = (cat.expenses || []).reduce((acc, ex) => acc + (Number(ex.amount) || 0), 0);
    totalSpent += catSpent;
    effectiveAllocatedOrSpent += Math.max(limit, catSpent);
  });

  const remainingToSpend = initial - totalSpent;
  const savings = initial - effectiveAllocatedOrSpent;

  return {
    initial,
    totalSpent,
    remainingToSpend,
    savings
  };
}

/* DOM Elementi */
const periodSelectorContainer = document.getElementById("periodSelectorContainer");
const noPeriodsBar = document.getElementById("noPeriodsBar");
const activeBudgetContent = document.getElementById("activeBudgetContent");

const periodSelect = document.getElementById("periodSelect");
const periodMetaText = document.getElementById("periodMetaText");
const periodLockedBadge = document.getElementById("periodLockedBadge");
const prevPeriodBtn = document.getElementById("prevPeriodBtn");
const nextPeriodBtn = document.getElementById("nextPeriodBtn");

const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const deletePeriodTopBtn = document.getElementById("deletePeriodTopBtn");
const toggleNewPeriodBtn = document.getElementById("toggleNewPeriodBtn");
const emptyNewPeriodBtn = document.getElementById("emptyNewPeriodBtn");

const editPeriodForm = document.getElementById("editPeriodForm");
const cancelEditPeriodBtn = document.getElementById("cancelEditPeriodBtn");
const newPeriodForm = document.getElementById("newPeriodForm");
const cancelNewPeriodBtn = document.getElementById("cancelNewPeriodBtn");
const copyCategoriesRow = document.getElementById("copyCategoriesRow");

const periodNameInput = document.getElementById("periodNameInput");
const initialBudgetInput = document.getElementById("initialBudgetInput");
const startDateInput = document.getElementById("startDateInput");
const endDateInput = document.getElementById("endDateInput");

const remainingTotalValue = document.getElementById("remainingTotalValue");
const spentTotalValue = document.getElementById("spentTotalValue");
const initialBudgetValue = document.getElementById("initialBudgetValue");
const savingsValue = document.getElementById("savingsValue");

const addCategorySection = document.getElementById("addCategorySection");
const addCategoryForm = document.getElementById("addCategoryForm");
const newCatName = document.getElementById("newCatName");
const newCatLimit = document.getElementById("newCatLimit");

const sortCategoriesSelect = document.getElementById("sortCategoriesSelect");
const categoriesList = document.getElementById("categoriesList");

const finishPeriodContainer = document.getElementById("finishPeriodContainer");
const finishPeriodBtn = document.getElementById("finishPeriodBtn");

/* Modal za potvrdu */
const confirmModalOverlay = document.getElementById("confirmModalOverlay");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalMessage = document.getElementById("confirmModalMessage");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalConfirmBtn = document.getElementById("confirmModalConfirmBtn");

function openConfirmModal({ title, message, confirmLabel, onConfirm }) {
  confirmModalTitle.textContent = title || "Potvrda";
  confirmModalMessage.textContent = message || "Jeste li sigurni?";
  confirmModalConfirmBtn.textContent = confirmLabel || "Potvrdi";
  pendingConfirmAction = onConfirm;
  confirmModalOverlay.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModalOverlay.classList.add("hidden");
  pendingConfirmAction = null;
}

confirmModalCancelBtn.addEventListener("click", closeConfirmModal);
confirmModalOverlay.addEventListener("click", e => {
  if (e.target === confirmModalOverlay) closeConfirmModal();
});
confirmModalConfirmBtn.addEventListener("click", () => {
  const fn = pendingConfirmAction;
  closeConfirmModal();
  if (typeof fn === "function") fn();
});

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function populateEditPeriodForm() {
  const period = getActivePeriod();
  if (!period) return;
  periodNameInput.value = period.name || "";
  initialBudgetInput.value = period.initialBudget ?? "";
  startDateInput.value = period.startDate || "";
  endDateInput.value = period.endDate || "";
}

function openNewPeriodPanel() {
  isCreatingNewPeriod = true;
  activeInlineEdit = null;
  editPeriodForm.classList.add("hidden");

  document.getElementById("newPeriodName").value = "";
  document.getElementById("newPeriodBudget").value = "";
  document.getElementById("newPeriodStart").value = "";
  document.getElementById("newPeriodEnd").value = "";

  if (state.periods.length > 0) {
    copyCategoriesRow.classList.remove("hidden");
  } else {
    copyCategoriesRow.classList.add("hidden");
  }

  renderAll();
  document.getElementById("newPeriodName").focus();
}

function closeNewPeriodPanel() {
  isCreatingNewPeriod = false;
  newPeriodForm.classList.add("hidden");
  renderAll();
}

function renderAll() {
  // Dok se kreira novo razdoblje, sakrij prethodni budžet i kontrole
  if (isCreatingNewPeriod) {
    periodSelectorContainer.classList.add("hidden");
    noPeriodsBar.classList.add("hidden");
    editPeriodForm.classList.add("hidden");
    activeBudgetContent.classList.add("hidden");
    newPeriodForm.classList.remove("hidden");
    return;
  }

  newPeriodForm.classList.add("hidden");
  const period = getActivePeriod();

  if (!period) {
    periodSelectorContainer.classList.add("hidden");
    noPeriodsBar.classList.remove("hidden");
    activeBudgetContent.classList.add("hidden");
    editPeriodForm.classList.add("hidden");
    return;
  }

  const locked = isPeriodLocked(period);

  periodSelectorContainer.classList.remove("hidden");
  noPeriodsBar.classList.add("hidden");
  activeBudgetContent.classList.remove("hidden");

  // Gumb "Obriši razdoblje" uvijek je vidljiv i za aktivna i za završena razdoblja
  deletePeriodTopBtn.classList.remove("hidden");

  if (locked) {
    editPeriodForm.classList.add("hidden");
    toggleSettingsBtn.classList.add("hidden");
    addCategorySection.classList.add("hidden");
    finishPeriodContainer.classList.add("hidden");
    periodLockedBadge.classList.remove("hidden");
    periodLockedBadge.textContent = period.completed ? "Završeno" : "Prošlo razdoblje";
  } else {
    toggleSettingsBtn.classList.remove("hidden");
    addCategorySection.classList.remove("hidden");
    finishPeriodContainer.classList.remove("hidden");
    periodLockedBadge.classList.add("hidden");
  }

  const metrics = calculatePeriodMetrics(period);

  periodSelect.innerHTML = state.periods
    .map(
      p =>
        `<option value="${escapeHtml(p.id)}" ${p.id === period.id ? "selected" : ""}>${escapeHtml(
          p.name || "Bez naziva"
        )}</option>`
    )
    .join("");

  const idx = state.periods.findIndex(p => p.id === period.id);
  prevPeriodBtn.disabled = idx <= 0;
  nextPeriodBtn.disabled = idx < 0 || idx >= state.periods.length - 1;

  periodMetaText.textContent =
    period.startDate && period.endDate
      ? `${formatDateHR(period.startDate)} – ${formatDateHR(period.endDate)}`
      : "";

  remainingTotalValue.textContent = formatEUR(metrics.remainingToSpend);
  spentTotalValue.textContent = formatEUR(metrics.totalSpent);
  initialBudgetValue.textContent = formatEUR(metrics.initial);
  savingsValue.textContent = formatEUR(metrics.savings);

  const remCard = document.querySelector(".card-remaining");
  remCard.classList.toggle("is-negative", metrics.remainingToSpend < 0);

  const savCard = document.querySelector(".card-savings");
  savCard.classList.toggle("is-negative", metrics.savings < 0);

  sortCategoriesSelect.value = state.sortOrder || "default";

  renderCategories(period, locked);
}

function renderCategories(period, locked) {
  if (!period.categories || period.categories.length === 0) {
    categoriesList.innerHTML = `<div class="card empty-state">Nema unesenih kategorija za ovo razdoblje.</div>`;
    return;
  }

  const enriched = period.categories.map((cat, index) => {
    const expenses = cat.expenses || [];
    const spent = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const lastSpentTs = expenses.reduce((maxTs, e) => {
      const ts = Number(e.createdAt) || 0;
      return ts > maxTs ? ts : maxTs;
    }, 0);
    return { cat, spent, lastSpentTs, index };
  });

  if (state.sortOrder === "spent-desc") {
    enriched.sort((a, b) => b.spent - a.spent || a.index - b.index);
  } else if (state.sortOrder === "spent-asc") {
    enriched.sort((a, b) => a.spent - b.spent || a.index - b.index);
  } else if (state.sortOrder === "last-spent") {
    enriched.sort((a, b) => {
      if (b.lastSpentTs !== a.lastSpentTs) return b.lastSpentTs - a.lastSpentTs;
      return a.index - b.index;
    });
  }

  categoriesList.innerHTML = enriched
    .map(({ cat, spent }) => {
      const limit = Number(cat.limit) || 0;
      const remainingInCat = limit - spent;
      const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : spent > 0 ? 100 : 0;
      const statusClass = spent > limit && limit > 0 ? "over" : pct >= 80 ? "warn" : "";
      const dotColor = spent > limit && limit > 0 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981";

      const isEditingCat =
        !locked && activeInlineEdit && activeInlineEdit.type === "cat" && activeInlineEdit.catId === cat.id;

      const inlineCatBox = isEditingCat
        ? `
          <form class="inline-edit-box" data-inline-form="cat" data-cat-id="${escapeHtml(cat.id)}">
            <div class="inline-edit-fields">
              <input type="text" name="catName" value="${escapeHtml(cat.name)}" placeholder="Naziv" required />
              <input type="number" name="catLimit" step="0.01" min="0" inputmode="decimal" value="${escapeHtml(
                cat.limit
              )}" placeholder="Iznos" required />
            </div>
            <div class="inline-edit-actions">
              <button type="button" class="btn btn-outline" data-action="cancel-inline">Odustani</button>
              <button type="submit" class="btn btn-light">Spremi</button>
            </div>
          </form>
        `
        : "";

      const categoryActionsHtml = !locked
        ? `
          <div class="category-actions">
            <button type="button" class="cat-action-btn" data-action="edit-cat" data-cat-id="${escapeHtml(
              cat.id
            )}">Uredi</button>
            <button type="button" class="cat-action-btn danger" data-action="del-cat" data-cat-id="${escapeHtml(
              cat.id
            )}">Obriši</button>
          </div>
        `
        : "";

      const expenseFormHtml = !locked
        ? `
          <form class="expense-form compact-input-row" data-cat-id="${escapeHtml(cat.id)}">
            <input type="text" name="expTitle" placeholder="Opis troška" required />
            <input type="number" name="expAmount" step="0.01" min="0.01" inputmode="decimal" placeholder="Iznos" required />
            <button type="submit" class="btn-plus" title="Dodaj trošak" aria-label="Dodaj trošak">+</button>
          </form>
        `
        : "";

      const expensesHtml =
        cat.expenses && cat.expenses.length > 0
          ? `<div class="expense-list">
              ${cat.expenses
                .map(ex => {
                  const isEditingExp =
                    !locked &&
                    activeInlineEdit &&
                    activeInlineEdit.type === "expense" &&
                    activeInlineEdit.catId === cat.id &&
                    activeInlineEdit.expId === ex.id;

                  const editRowHtml = isEditingExp
                    ? `<form class="expense-edit-form" data-inline-form="expense" data-cat-id="${escapeHtml(
                        cat.id
                      )}" data-exp-id="${escapeHtml(ex.id)}">
                        <div class="inline-edit-fields">
                          <input type="text" name="editExpTitle" value="${escapeHtml(
                            ex.title
                          )}" placeholder="Opis troška" required />
                          <input type="number" name="editExpAmount" step="0.01" min="0.01" inputmode="decimal" value="${escapeHtml(
                            ex.amount
                          )}" placeholder="Iznos" required />
                        </div>
                        <div class="inline-edit-actions">
                          <button type="button" class="btn btn-outline" data-action="cancel-inline">Odustani</button>
                          <button type="submit" class="btn btn-light">Spremi</button>
                        </div>
                      </form>`
                    : "";

                  const expButtonsHtml = !locked
                    ? `
                      <button type="button" class="expense-btn" data-action="edit-expense" data-cat-id="${escapeHtml(
                        cat.id
                      )}" data-exp-id="${escapeHtml(ex.id)}">Uredi</button>
                      <button type="button" class="expense-btn del" data-action="del-expense" data-cat-id="${escapeHtml(
                        cat.id
                      )}" data-exp-id="${escapeHtml(ex.id)}" title="Obriši trošak">&times;</button>
                    `
                    : "";

                  return `
                    <div class="expense-item">
                      <div class="expense-main-row">
                        <div class="expense-info">
                          <span class="expense-desc">${escapeHtml(ex.title || "Trošak")}</span>
                          <span class="expense-date">${escapeHtml(ex.date || "")}</span>
                        </div>
                        <div class="expense-right">
                          <span class="expense-amount">-${formatEUR(ex.amount)}</span>
                          ${expButtonsHtml}
                        </div>
                      </div>
                      ${editRowHtml}
                    </div>`;
                })
                .join("")}
            </div>`
          : "";

      return `
        <article class="category-card">
          <div class="category-top">
            <div class="category-title-wrap">
              <span class="category-dot" style="background:${dotColor}"></span>
              <h3 class="category-name">${escapeHtml(cat.name)}</h3>
            </div>
            ${categoryActionsHtml}
          </div>

          ${inlineCatBox}

          <div class="category-stats">
            <div class="category-remaining-row ${remainingInCat < 0 ? "is-over" : ""}">
              Preostalo: ${formatEUR(remainingInCat)}
            </div>
            <div class="category-numbers">
              <span class="category-spent">Potrošeno: ${formatEUR(spent)}</span>
              <span class="category-limit">Zadani iznos: ${formatEUR(limit)} (${pct}%)</span>
            </div>
          </div>

          <div class="progress-track">
            <div class="progress-fill ${statusClass}" style="width:${pct}%"></div>
          </div>

          ${expenseFormHtml}
          ${expensesHtml}
        </article>
      `;
    })
    .join("");
}

/* Event Listeneri */
periodSelect.addEventListener("change", e => {
  state.activePeriodId = e.target.value;
  activeInlineEdit = null;
  editPeriodForm.classList.add("hidden");
  saveState();
  renderAll();
});

prevPeriodBtn.addEventListener("click", () => {
  const idx = state.periods.findIndex(p => p.id === state.activePeriodId);
  if (idx > 0) {
    state.activePeriodId = state.periods[idx - 1].id;
    activeInlineEdit = null;
    editPeriodForm.classList.add("hidden");
    saveState();
    renderAll();
  }
});

nextPeriodBtn.addEventListener("click", () => {
  const idx = state.periods.findIndex(p => p.id === state.activePeriodId);
  if (idx >= 0 && idx < state.periods.length - 1) {
    state.activePeriodId = state.periods[idx + 1].id;
    activeInlineEdit = null;
    editPeriodForm.classList.add("hidden");
    saveState();
    renderAll();
  }
});

toggleSettingsBtn.addEventListener("click", () => {
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;
  const isOpening = editPeriodForm.classList.contains("hidden");
  if (isOpening) {
    populateEditPeriodForm();
    editPeriodForm.classList.remove("hidden");
  } else {
    editPeriodForm.classList.add("hidden");
  }
});

cancelEditPeriodBtn.addEventListener("click", () => {
  editPeriodForm.classList.add("hidden");
});

editPeriodForm.addEventListener("submit", e => {
  e.preventDefault();
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;

  const newName = periodNameInput.value.trim();
  const parsedBudget = parseFloat(String(initialBudgetInput.value).replace(",", "."));
  p.name = newName || "Razdoblje";
  p.initialBudget = isNaN(parsedBudget) || parsedBudget < 0 ? 0 : parsedBudget;
  p.startDate = startDateInput.value;
  p.endDate = endDateInput.value;

  saveState();
  editPeriodForm.classList.add("hidden");
  renderAll();
});

// Brisanje bilo kojeg razdoblja (uključujući i završena/prošla razdoblja)
deletePeriodTopBtn.addEventListener("click", () => {
  const p = getActivePeriod();
  if (!p) return;

  openConfirmModal({
    title: "Obriši razdoblje",
    message: `Želite li stvarno obrisati razdoblje "${p.name}" i sve njegove podatke?`,
    confirmLabel: "Obriši",
    onConfirm: () => {
      state.periods = state.periods.filter(item => item.id !== p.id);
      if (state.periods.length === 0) {
        state.activePeriodId = null;
      } else {
        state.activePeriodId = state.periods[state.periods.length - 1].id;
      }
      activeInlineEdit = null;
      editPeriodForm.classList.add("hidden");
      saveState();
      renderAll();
    }
  });
});

toggleNewPeriodBtn.addEventListener("click", () => {
  openNewPeriodPanel();
});

emptyNewPeriodBtn.addEventListener("click", () => {
  openNewPeriodPanel();
});

cancelNewPeriodBtn.addEventListener("click", () => {
  closeNewPeriodPanel();
});

newPeriodForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("newPeriodName").value.trim() || "Novo razdoblje";
  const rawBudget = String(document.getElementById("newPeriodBudget").value).replace(",", ".");
  const budget = Math.max(0, parseFloat(rawBudget) || 0);
  const start = document.getElementById("newPeriodStart").value;
  const end = document.getElementById("newPeriodEnd").value;
  const copyCats = document.getElementById("copyCategoriesCheck").checked;

  const current = getActivePeriod();
  const copiedCategories =
    current && copyCats
      ? (current.categories || []).map(c => ({
          id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          name: c.name,
          limit: Number(c.limit) || 0,
          expenses: []
        }))
      : [];

  const created = {
    id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    name,
    initialBudget: budget,
    startDate: start,
    endDate: end,
    completed: false,
    categories: copiedCategories
  };

  state.periods.push(created);
  state.activePeriodId = created.id;
  activeInlineEdit = null;
  isCreatingNewPeriod = false;
  saveState();

  newPeriodForm.reset();
  renderAll();
});

/* Završi ovo razdoblje */
finishPeriodBtn.addEventListener("click", () => {
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;

  openConfirmModal({
    title: "Završi ovo razdoblje",
    message: `Želite li stvarno završiti razdoblje "${p.name}"? Nakon završetka više neće biti moguće mijenjati podatke u tom razdoblju.`,
    confirmLabel: "Završi",
    onConfirm: () => {
      p.completed = true;
      activeInlineEdit = null;
      saveState();
      openNewPeriodPanel();
    }
  });
});

/* Sortiranje kategorija */
sortCategoriesSelect.addEventListener("change", e => {
  state.sortOrder = e.target.value;
  saveState();
  renderAll();
});

/* Dodavanje kategorije */
addCategoryForm.addEventListener("submit", e => {
  e.preventDefault();
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;

  const name = newCatName.value.trim();
  const rawLimit = String(newCatLimit.value).replace(",", ".");
  const limit = Math.max(0, parseFloat(rawLimit) || 0);
  if (!name) return;

  p.categories.push({
    id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    name,
    limit,
    expenses: []
  });

  saveState();
  newCatName.value = "";
  newCatLimit.value = "";
  renderAll();
});

/* Unos troška i spremanje inline izmjena */
categoriesList.addEventListener("submit", e => {
  e.preventDefault();
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;

  if (e.target.classList.contains("expense-form")) {
    const catId = e.target.getAttribute("data-cat-id");
    const titleInput = e.target.elements.expTitle;
    const amountInput = e.target.elements.expAmount;

    const title = titleInput.value.trim();
    const amount = parseFloat(String(amountInput.value).replace(",", "."));
    if (!title || isNaN(amount) || amount <= 0) return;

    const cat = p.categories.find(c => c.id === catId);
    if (!cat) return;

    const dateTimeStr = formatCurrentDateTimeHR();

    cat.expenses.unshift({
      id: "e_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
      title,
      amount,
      date: dateTimeStr,
      createdAt: Date.now()
    });

    saveState();
    renderAll();
    return;
  }

  const inlineType = e.target.getAttribute("data-inline-form");
  if (!inlineType) return;

  const catId = e.target.getAttribute("data-cat-id");
  const cat = p.categories.find(c => c.id === catId);
  if (!cat) return;

  if (inlineType === "cat") {
    const newName = e.target.elements.catName.value.trim();
    const rawVal = String(e.target.elements.catLimit.value).replace(",", ".");
    const val = parseFloat(rawVal);
    if (newName) {
      cat.name = newName;
    }
    if (!isNaN(val) && val >= 0) {
      cat.limit = val;
    }
    activeInlineEdit = null;
    saveState();
    renderAll();
  } else if (inlineType === "expense") {
    const expId = e.target.getAttribute("data-exp-id");
    const exp = (cat.expenses || []).find(item => item.id === expId);
    if (exp) {
      const newTitle = e.target.elements.editExpTitle.value.trim();
      const rawAmt = String(e.target.elements.editExpAmount.value).replace(",", ".");
      const newAmt = parseFloat(rawAmt);
      if (newTitle && !isNaN(newAmt) && newAmt > 0) {
        exp.title = newTitle;
        exp.amount = newAmt;
      }
    }
    activeInlineEdit = null;
    saveState();
    renderAll();
  }
});

/* Klikovi na gumbe unutar kategorija */
categoriesList.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  if (action === "cancel-inline") {
    activeInlineEdit = null;
    renderAll();
    return;
  }

  const catId = btn.getAttribute("data-cat-id");
  const p = getActivePeriod();
  if (!p || isPeriodLocked(p)) return;
  const cat = p.categories.find(c => c.id === catId);
  if (!cat) return;

  if (action === "edit-cat") {
    activeInlineEdit = { type: "cat", catId };
    renderAll();
  } else if (action === "del-cat") {
    openConfirmModal({
      title: "Obriši kategoriju",
      message: `Želite li stvarno obrisati kategoriju "${cat.name}" i sve njezine troškove?`,
      confirmLabel: "Obriši",
      onConfirm: () => {
        p.categories = p.categories.filter(c => c.id !== catId);
        activeInlineEdit = null;
        saveState();
        renderAll();
      }
    });
  } else if (action === "edit-expense") {
    const expId = btn.getAttribute("data-exp-id");
    activeInlineEdit = { type: "expense", catId, expId };
    renderAll();
  } else if (action === "del-expense") {
    const expId = btn.getAttribute("data-exp-id");
    const exp = (cat.expenses || []).find(item => item.id === expId);
    if (!exp) return;

    openConfirmModal({
      title: "Obriši trošak",
      message: `Želite li stvarno obrisati trošak "${exp.title}" (${formatEUR(exp.amount)})?`,
      confirmLabel: "Obriši",
      onConfirm: () => {
        cat.expenses = (cat.expenses || []).filter(item => item.id !== expId);
        if (activeInlineEdit && activeInlineEdit.expId === expId) {
          activeInlineEdit = null;
        }
        saveState();
        renderAll();
      }
    });
  }
});

// Inicijalni prikaz
renderAll();
