const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createContainer() {
    return {
        set innerHTML(html) {
            this.html = html;
            this.items = { active: [], deleted: [] };
            this.selectAll = {};
            this.buttons = {};
            for (const match of html.matchAll(/data-draft-selection="(active|deleted)" value="([^"]*)"/g)) {
                this.items[match[1]].push({ value: match[2], checked: false });
            }
            for (const match of html.matchAll(/data-draft-select-all="(active|deleted)"/g)) {
                this.selectAll[match[1]] = { checked: false, indeterminate: false, closest: () => this };
            }
            for (const match of html.matchAll(/data-draft-delete-selected="(active|deleted)"/g)) {
                this.buttons[match[1]] = { disabled: true, textContent: '' };
            }
        },
        querySelectorAll(selector) {
            const type = selector.match(/data-draft-selection="(active|deleted)"/)[1];
            return this.items[type];
        },
        querySelector(selector) {
            const match = selector.match(/data-draft-(select-all|delete-selected)="(active|deleted)"/);
            return match[1] === 'select-all' ? this.selectAll[match[2]] : this.buttons[match[2]];
        }
    };
}

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`draft selection and deletion in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const start = source.indexOf('function escapeDraftHtml(');
        const end = source.indexOf('function buildStatementRows(', start);
        assert.ok(start >= 0 && end > start);

        const storage = new Map([
            ['p3_pos_drafts', JSON.stringify([{ id: 1, client: 'A' }, { id: 2, client: 'B' }, { id: 3, client: 'C' }])],
            ['p3_pos_deleted_drafts', JSON.stringify([{ id: 4, client: 'D' }, { id: 5, client: 'E' }])]
        ]);
        const containers = { draftsList: createContainer(), draftView: createContainer() };
        let accepted = false;
        const confirmations = [];
        const context = vm.createContext({
            document: { getElementById: id => containers[id] },
            localStorage: {
                getItem: key => storage.get(key) || null,
                setItem: (key, value) => storage.set(key, value)
            },
            confirm: message => { confirmations.push(message); return accepted; },
            alert: message => { throw new Error(message); }
        });
        vm.runInContext(source.slice(start, end), context);
        const read = key => JSON.parse(storage.get(key));
        const ids = key => read(key).map(item => item.id);
        context.loadDrafts();

        const first = containers.draftsList.items.active[0];
        first.checked = true;
        context.selectDraft('active', first);
        assert.equal(containers.draftView.items.active[0].checked, true);
        assert.equal(containers.draftView.selectAll.active.indeterminate, true);
        assert.equal(containers.draftView.buttons.active.textContent, 'Move selected to bin (1)');

        const all = containers.draftView.selectAll.active;
        all.checked = true;
        context.selectAllDrafts('active', all);
        assert.equal(containers.draftsList.selectAll.active.checked, true);
        const third = containers.draftView.items.active[2];
        third.checked = false;
        context.selectDraft('active', third);
        context.deleteSelectedDrafts('active');
        assert.deepEqual(ids('p3_pos_drafts'), [1, 2, 3]);
        assert.equal(containers.draftsList.buttons.active.disabled, false);

        accepted = true;
        context.deleteSelectedDrafts('active');
        assert.deepEqual(ids('p3_pos_drafts'), [3]);
        assert.deepEqual(ids('p3_pos_deleted_drafts'), [4, 5, 1, 2]);
        assert.ok(read('p3_pos_deleted_drafts')[2].deletedAt);
        assert.equal(containers.draftsList.buttons.active.disabled, true);

        const deleted = containers.draftView.items.deleted[0];
        deleted.checked = true;
        context.selectDraft('deleted', deleted);
        accepted = false;
        context.deleteSelectedDrafts('deleted');
        assert.deepEqual(ids('p3_pos_deleted_drafts'), [4, 5, 1, 2]);
        accepted = true;
        context.deleteSelectedDrafts('deleted');
        assert.match(confirmations.at(-1), /cannot be undone/i);
        assert.deepEqual(ids('p3_pos_deleted_drafts'), [5, 1, 2]);

        context.restoreDeletedDraft(5);
        assert.deepEqual(ids('p3_pos_drafts'), [3, 5]);
        assert.deepEqual(ids('p3_pos_deleted_drafts'), [1, 2]);
        context.deleteDraft(3);
        assert.deepEqual(ids('p3_pos_drafts'), [5]);
        context.permanentlyDeleteDraft(3);
        assert.deepEqual(ids('p3_pos_deleted_drafts'), [1, 2]);

        const remainingAll = containers.draftsList.selectAll.deleted;
        remainingAll.checked = true;
        context.selectAllDrafts('deleted', remainingAll);
        context.deleteSelectedDrafts('deleted');
        assert.deepEqual(ids('p3_pos_deleted_drafts'), []);
        assert.match(containers.draftView.html, /Recycle bin is empty/);
    });
}
