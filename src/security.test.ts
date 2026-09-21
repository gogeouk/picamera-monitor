import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, hostKeyAllowed } from './ssh.js';
import { sameSiteAction } from './guard.js';

// A throwaway key generated for this test, with the fingerprint ssh-keygen -lf gave it.
const BLOB = Buffer.from('AAAAC3NzaC1lZDI1NTE5AAAAIMmdRbtS/7lMEJyKgyzeuBFh1d+NqiKyQSdkkvQmv8v4', 'base64');
const FP = 'SHA256:Mgey8b04MLYsAfx97fCuJnWKjtwCYS09mM12w7Tslts';

test('fingerprint matches ssh-keygen', () => {
  assert.equal(fingerprint(BLOB), FP);
});

test('host keys: only pinned keys are accepted, and no pins means no connection', () => {
  assert.equal(hostKeyAllowed(BLOB, [FP]), true);
  assert.equal(hostKeyAllowed(BLOB, ['SHA256:somethingElse']), false);
  assert.equal(hostKeyAllowed(BLOB, []), false);
  assert.equal(hostKeyAllowed(BLOB, undefined), false);
});

const own = { host: 'cams.gogeo.uk', 'hx-request': 'true', origin: 'https://cams.gogeo.uk', 'sec-fetch-site': 'same-origin' };

test("the dashboard's own buttons are allowed", () => {
  assert.equal(sameSiteAction(own), true);
  // Older browsers may omit Origin and Sec-Fetch-Site on same-origin requests.
  assert.equal(sameSiteAction({ host: 'cams.gogeo.uk', 'hx-request': 'true' }), true);
});

test('cross-site and non-HTMX requests are refused', () => {
  assert.equal(sameSiteAction({ ...own, 'hx-request': undefined }), false, 'plain form post from anywhere');
  assert.equal(sameSiteAction({ ...own, origin: 'https://evil.example' }), false, 'other origin');
  assert.equal(sameSiteAction({ ...own, 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(sameSiteAction({ ...own, 'sec-fetch-site': 'same-site' }), false, 'a sibling subdomain');
  assert.equal(sameSiteAction({ ...own, origin: 'null' }), false, 'sandboxed or opaque origin');
});
