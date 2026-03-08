import { expect, test } from "@playwright/test";

test("rxdb v2 stays reactive across both todo panels", async ({ page }) => {
  const todoText = `codex smoke ${Date.now()}`;

  await page.goto("/rxdb-playground", {
    // use load; networkidle never resolves because RxDB replication keeps connections open
    waitUntil: "load",
  });

  const replicationStatus = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Replication status", exact: true }),
  });
  const todosV2Panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Todos v2", exact: true }),
  });
  const replicationPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Todos v2 Replication", exact: true }),
  });

  await expect(replicationStatus).toContainText(/In sync|Syncing with backend/u);

  await todosV2Panel.getByPlaceholder("New todo…").fill(todoText);
  await todosV2Panel.getByRole("button", { name: "Add" }).click();

  const todosV2Item = todosV2Panel.locator("li").filter({ hasText: todoText });
  const replicationItem = replicationPanel.locator("li").filter({ hasText: todoText });

  await expect(todosV2Item).toBeVisible();
  await expect(replicationItem).toBeVisible();

  await todosV2Item.getByRole("checkbox").check();
  await expect(todosV2Item.getByRole("checkbox")).toBeChecked();
  await expect(replicationItem.getByRole("checkbox")).toBeChecked();

  await todosV2Item.getByRole("button", { name: "Delete" }).click();
  await expect(todosV2Item).toHaveCount(0);
  await expect(replicationItem).toHaveCount(0);
});
