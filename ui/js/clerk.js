// auth is omitted from this public snapshot. callers still expect these names.

const _publicUser = { id: "public" };
const _clerk = { user: _publicUser };

function onClerkAuthChange(_fn) {}

function onClerkSignedIn(_fn) {}

function clearClerkAuthHash() {}

function mountClerkSignIn() {}

function unmountClerkSignIn() {}

async function bootstrapClerk() {
  return _clerk;
}

async function clerkToken() {
  return null;
}

function getClerk() {
  return _clerk;
}

function ensureAuthReturnPath() {}
