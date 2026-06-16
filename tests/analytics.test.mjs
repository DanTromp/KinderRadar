import test from 'node:test';
import assert from 'node:assert/strict';

function installBrowserStub({ plausibleDomain = '', doNotTrack = '0', plausible } = {}) {
  const appended = [];
  const listeners = [];

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      KINDERRADAR_PLAUSIBLE_DOMAIN: plausibleDomain,
      plausible,
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      head: {
        appendChild(node) {
          appended.push(node);
        },
      },
      createElement(tagName) {
        return {
          tagName,
          dataset: {},
          defer: false,
          src: '',
        };
      },
      querySelector() {
        return null;
      },
      addEventListener(type, handler, options) {
        listeners.push({ type, handler, options });
      },
    },
  });

  return { appended, listeners };
}

function cleanupBrowserStub() {
  delete globalThis.navigator;
  delete globalThis.window;
  delete globalThis.document;
}

async function importAnalytics() {
  return import(`../assets/analytics.js?test=${Date.now()}-${Math.random()}`);
}

test('analytics initializes Plausible when configured', async () => {
  const { appended } = installBrowserStub({ plausibleDomain: 'haltern.kinderradar.de' });
  try {
    await importAnalytics();
    assert.equal(typeof window.plausible, 'function');
    assert.equal(appended.length, 1);
    assert.equal(appended[0].src, 'https://plausible.io/js/script.js');
    assert.equal(appended[0].dataset.domain, 'haltern.kinderradar.de');
  } finally {
    cleanupBrowserStub();
  }
});

test('analytics respects do-not-track before loading Plausible', async () => {
  const { appended } = installBrowserStub({
    plausibleDomain: 'haltern.kinderradar.de',
    doNotTrack: '1',
  });
  try {
    await importAnalytics();
    assert.equal(appended.length, 0);
  } finally {
    cleanupBrowserStub();
  }
});

test('track sanitizes string props before sending', async () => {
  const calls = [];
  installBrowserStub({
    plausible(name, payload) {
      calls.push({ name, payload });
    },
  });
  try {
    const { track } = await importAnalytics();
    track('search', {
      q: 'x'.repeat(80),
      results: 12,
      empty: null,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'search');
    assert.equal(calls[0].payload.props.q.length, 60);
    assert.equal(calls[0].payload.props.results, 12);
    assert.equal(Object.hasOwn(calls[0].payload.props, 'empty'), false);
  } finally {
    cleanupBrowserStub();
  }
});
