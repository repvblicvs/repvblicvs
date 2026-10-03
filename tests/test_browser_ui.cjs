'use strict';
// Run: node tests/test_browser_ui.cjs
// Control asynchronous file reads without timers or a browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element(id = '') {
  let value = '';
  const classes = new Set();
  return {
    id, textContent: '', disabled: false, children: [], listeners: new Map(),
    selectionStart: 0, selectionEnd: 0,
    get value() { return value; },
    set value(next) { value = id === 'csv-input' ? String(next).replace(/\r\n?/g, '\n') : String(next); },
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
}

function harness(source) {
  const elements = new Map();
  let registeredTool;
  const get = id => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    createElement() { return element(); },
    querySelectorAll() { return []; },
    modelContext: { registerTool(tool) { registeredTool = tool; } },
  };
  vm.runInNewContext(source, {
    document, TextEncoder, TextDecoder, AbortController,
    window: { addEventListener() {} },
  });
  const dispatch = (id, type, event = {}) => get(id).listeners.get(type)(event);
  return {
    get,
    select(file) { return dispatch('csv-file', 'change', { target: { files: file ? [file] : [] } }); },
    sample() { dispatch('sample-button', 'click'); },
    inspect() { dispatch('inspect-button', 'click'); },
    edit(text) { get('csv-input').value = text; dispatch('csv-input', 'input'); },
    paste(text) {
      const input = get('csv-input');
      input.setSelectionRange(0, input.value.length);
      let prevented = false;
      dispatch('csv-input', 'paste', {
        preventDefault() { prevented = true; },
        clipboardData: { types: ['text/plain'], getData() { return text; } },
      });
      assert(prevented);
    },
    tool(text) { return registeredTool.execute({ csv: text }); },
    snapshot() {
      return {
        input: get('csv-input').value,
        fileName: get('file-name').textContent,
        summary: get('result-summary').textContent,
        state: get('result-state').textContent,
        preview: get('json-preview').textContent,
        disabled: get('download-button').disabled,
        issues: get('issues').children.map(child => child.textContent),
      };
    },
  };
}

function deferredFile(name) {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {
    file: { name, size: 16, arrayBuffer() { return promise; } },
    resolve(text) { resolve(new TextEncoder().encode(text).buffer); },
    reject() { reject(new Error('Synthetic read failure')); },
    invalidUTF8() { resolve(new Uint8Array([0xff]).buffer); },
  };
}

async function checkSource(source) {
  let checks = 0;
  // A slower first selection must never replace a newer successful selection,
  // whether it eventually resolves, rejects, or contains invalid UTF-8.
  for (const completion of ['resolve', 'reject', 'invalidUTF8']) {
    const ui = harness(source), first = deferredFile('first.csv'), second = deferredFile('second.csv');
    const oldRead = ui.select(first.file), newRead = ui.select(second.file);
    second.resolve('id\r\n002\r\n');
    await newRead;
    const current = ui.snapshot();
    assert.equal(current.fileName, 'second.csv');
    assert.equal(JSON.parse(current.preview).rows[0][0], '002');
    first[completion]('id\n001\n');
    await oldRead;
    assert.deepEqual(ui.snapshot(), current);
    checks++;
  }

  // Later explicit text actions cancel outstanding reads, including failures.
  for (const action of ['sample', 'edit', 'paste', 'inspect', 'tool']) {
    for (const completion of ['resolve', 'reject']) {
      const ui = harness(source), file = deferredFile('pending.csv');
      const read = ui.select(file.file);
      if (action === 'edit') {
        ui.edit('id\n003\n');
        assert.equal(ui.snapshot().state, 'INPUT CHANGED');
        assert.equal(ui.snapshot().disabled, true);
        ui.inspect();
      } else if (action === 'paste') {
        ui.paste('id\r\n004\r\n');
        ui.inspect();
        assert.equal(JSON.parse(ui.snapshot().preview).rows[0][0], '004');
      } else if (action === 'tool') {
        assert.equal(ui.tool('id\n005\n').rowCount, 1);
      } else {
        ui[action]();
      }
      const current = ui.snapshot();
      assert.equal(current.fileName, '');
      assert.equal(current.state, 'PARSED');
      assert.equal(current.disabled, false);
      file[completion]('id\nOLD\n');
      await read;
      assert.deepEqual(ui.snapshot(), current);
      checks++;
    }
  }

  // Rejected new selections supersede older reads and retain the prior source
  // label, so the visible text is never attributed to the rejected file.
  for (const rejection of ['oversized', 'invalidUTF8', 'readFailure']) {
    for (const completion of ['resolve', 'reject']) {
      const ui = harness(source), accepted = deferredFile('accepted.csv');
      const acceptedRead = ui.select(accepted.file);
      accepted.resolve('id\n006\n');
      await acceptedRead;
      const older = deferredFile('older.csv');
      const oldRead = ui.select(older.file);
      if (rejection === 'oversized') {
        await ui.select({ name: 'large.csv', size: 2 * 1024 * 1024 + 1,
          arrayBuffer() { throw new Error('Oversized files must never be read'); } });
      } else {
        const invalid = deferredFile('rejected.csv');
        const newRead = ui.select(invalid.file);
        if (rejection === 'invalidUTF8') invalid.invalidUTF8();
        else invalid.reject();
        await newRead;
      }
      const current = ui.snapshot();
      assert.equal(current.fileName, 'accepted.csv');
      assert.equal(current.input, 'id\n006\n');
      assert.equal(current.state, 'INPUT ERROR');
      assert.equal(current.disabled, true);
      older[completion]('id\nOLD\n');
      await oldRead;
      assert.deepEqual(ui.snapshot(), current);
      ui.inspect();
      assert.equal(ui.snapshot().state, 'PARSED');
      assert.equal(JSON.parse(ui.snapshot().preview).rows[0][0], '006');
      checks++;
    }
  }

  const ui = harness(source), canceled = deferredFile('canceled.csv');
  const read = ui.select(canceled.file);
  await ui.select(null);
  ui.inspect();
  const current = ui.snapshot();
  canceled.resolve('id\nOLD\n');
  await read;
  assert.deepEqual(ui.snapshot(), current);
  checks++;
  return checks;
}

(async () => {
  let checks = 0;
  for (const app of ['site', 'docs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', app, 'app.js'), 'utf8');
    checks += await checkSource(source);
  }
  console.log(`PASS: ${checks} deterministic UI cases across site/docs: out-of-order reads, stale errors, sample/edit/paste/inspect/tool replacement, rejected selections, and cancellation.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
