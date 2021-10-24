
addEventListener('fetch', (event) => {
  event.respondWith(
    handleRequest(event.request).catch(
      (err) => new Response(err.stack, { status: 500 })
    )
  );
});


/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleRequest(request) {
  const requestOpts = {
    cf: {
      cacheEverything: self.__ENV__ === 'production',
    },
  };

  const response = await fetch(request, requestOpts);
  const clone = new Response(response.body, response);

  // addExperimentIDCookie(request, clone);
  addServerTimingHeaders(clone);

  return clone;
}

/**
 * @param {Request} request
 * @param {Response} response
 */
function addExperimentIDCookie(request, response) {
  const cookie = request.headers.get('cookie') || '';
  const xid = cookie.match(/(?:^|;) *xid=(\.\d+) *(?:;|$)/)
      ? RegExp.$1 : `${Math.random()}`.slice(1, 5);

  response.headers.set('Set-Cookie', [
    'xid=' + xid,
    'Path=/',
    'Max-Age=31536000',
    'SameSite=Strict',
    'HttpOnly',
    'Secure',
  ].join('; '));
}

/**
 * @param {Response} response
 * @returns {Response}
 */
function addServerTimingHeaders(response) {
  const cfCache = response.headers.get('cf-cache-status');
  if (cfCache) {
    response.headers.set('Server-Timing', `cf_cache;desc="${cfCache}"`)
  }

  const fastlyCache = response.headers.get('x-cache');
  if (fastlyCache) {
    response.headers.set('Server-Timing', `fastly_cache;desc="${fastlyCache}"`)
  }
}

