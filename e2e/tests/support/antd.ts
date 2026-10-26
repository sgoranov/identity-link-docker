import { expect, type Locator, type Page } from '@playwright/test';

// Locators and actions for the Ant Design components the admin console is built with. They find form fields by
// their label, as a user would, and fall back on Ant Design's class names only where its markup offers nothing else.

// The form item with this label, e.g. in a drawer. The label element carries its text as its title.
export function formItem(scope: Locator, label: string): Locator {
    return scope.locator('.ant-form-item').filter({ has: scope.page().locator(`label[title="${label}"]`) });
}

// The text input, text area or select input of a form item.
export function field(scope: Locator, label: string): Locator {
    return formItem(scope, label).locator('input, textarea').first();
}

// The error shown under a form item. A replaced error stays a moment longer, while it fades out.
export function fieldError(scope: Locator, label: string): Locator {
    return formItem(scope, label).locator('.ant-form-item-explain-error:not(.ant-form-show-help-item-leave)');
}

export async function fillFields(scope: Locator, values: Record<string, string>): Promise<void> {
    for (const [label, value] of Object.entries(values)) {
        await field(scope, label).fill(value);
    }
}

export function switchField(scope: Locator, label: string): Locator {
    return formItem(scope, label).getByRole('switch');
}

export async function setSwitch(scope: Locator, label: string, checked: boolean): Promise<void> {
    const control = switchField(scope, label);
    if ((await control.getAttribute('aria-checked')) !== String(checked)) {
        await control.click();
    }
    await expect(control).toHaveAttribute('aria-checked', String(checked));
}

// The options of the open select dropdown. Ant Design renders it at the end of the page.
function openDropdown(page: Page): Locator {
    return page.locator('.ant-select-dropdown:visible');
}

// Selects options of a select by their labels. For a select with search, it types each label first, so that the
// option is shown however many there are.
export async function chooseOptions(select: Locator, labels: string[], { search = false } = {}): Promise<void> {
    const page = select.page();
    await select.click();
    for (const label of labels) {
        if (search) {
            await select.fill(label);
        }
        await openDropdown(page).getByTitle(label, { exact: true }).click();
    }
    await closeDropdown(select);
}

// Closes the dropdown of a select, which could cover the fields below. Tab would select the highlighted option, and
// Escape would close the drawer as well.
async function closeDropdown(select: Locator): Promise<void> {
    await select.blur();
    await expect(openDropdown(select.page())).toHaveCount(0);
}

export async function chooseFieldOptions(
    scope: Locator,
    label: string,
    options: string[],
    { search = false } = {},
): Promise<void> {
    await chooseOptions(formItem(scope, label).getByRole('combobox'), options, { search });
}

// The labels of the options selected in a select of a form item.
export function selectedOptions(scope: Locator, label: string): Locator {
    return formItem(scope, label).locator('.ant-select-selection-item');
}

export async function removeSelectedOptions(scope: Locator, label: string, options: string[]): Promise<void> {
    for (const option of options) {
        await selectedOptions(scope, label)
            .filter({ hasText: new RegExp(`^${escapeRegExp(option)}$`) })
            .locator('.ant-select-selection-item-remove')
            .click();
    }
    await closeDropdown(formItem(scope, label).getByRole('combobox'));
}

// Adds values to a select in tags mode, such as the redirect URIs of a client.
export async function addTags(scope: Locator, label: string, values: string[]): Promise<void> {
    const input = formItem(scope, label).getByRole('combobox');
    for (const value of values) {
        await input.fill(value);
        await input.press('Enter');
    }
    await closeDropdown(input);
}

// A notification, by its title. Error notifications stay until they are closed.
export function notification(page: Page, title: string): Locator {
    return page.getByRole('alert').filter({ hasText: title });
}

// The confirmation that a delete button opens, by its question.
export function popconfirm(page: Page, question: string): Locator {
    return page.getByRole('tooltip').filter({ hasText: question });
}

// The rows of the table on the page, without its header and the row it shows when it is empty.
export function tableRows(scope: Page | Locator): Locator {
    return scope.locator('.ant-table-tbody > tr.ant-table-row');
}

// The table row with a cell that has exactly this text.
export function tableRow(scope: Page | Locator, cellText: string): Locator {
    return tableRows(scope).filter({ has: scope.getByRole('cell', { name: cellText, exact: true }) });
}

// The cells of a column, in the order the table shows them.
export async function columnCells(page: Page, header: string): Promise<Locator> {
    const headers = (await page.locator('.ant-table-thead th').allTextContents()).map((text) => text.trim());
    const index = headers.indexOf(header);
    expect(index, `column "${header}" in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);

    return tableRows(page).locator(`td:nth-child(${index + 1})`);
}

// Clicks a column header to sort by it: ascending first, then descending, then unsorted.
export async function sortBy(page: Page, header: string): Promise<void> {
    await page.locator('.ant-table-thead th').filter({ hasText: new RegExp(`^${escapeRegExp(header)}$`) }).click();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
