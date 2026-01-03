/**
 * VS Code webview UI helpers.
 * DOM manipulation for probe results display.
 */

/**
 * Create a section container for probe results.
 */
export function createSection(id: string, title: string): HTMLElement {
  const section = document.createElement("section");
  section.id = id;
  section.innerHTML = `<h2>${title}</h2>`;
  return section;
}

/**
 * Add a result row to a section.
 */
export function addResult(
  section: HTMLElement,
  label: string,
  value: string,
  status: "pass" | "fail" | "warn"
): void {
  const row = document.createElement("div");
  row.className = `result-row result-${status}`;
  row.innerHTML = `
    <span class="result-label">${label}</span>
    <span class="result-value">${value}</span>
    <span class="result-status">${status.toUpperCase()}</span>
  `;
  section.appendChild(row);
}

/**
 * Get or create the results container.
 */
export function getResultsContainer(): HTMLElement {
  let container = document.getElementById("results");
  if (!container) {
    container = document.createElement("div");
    container.id = "results";
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Clear all results.
 */
export function clearResults(): void {
  const container = getResultsContainer();
  container.innerHTML = "";
}
