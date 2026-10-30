// google-webhook: receives Google Calendar push notifications (events.watch) and queues an import.
// Deploy with `verify_jwt = false`: Google can't send a JWT. Requests are authenticated by the
// channel token (HMAC of the channel id with GOOGLE_WEBHOOK_SECRET). See
// supabase/functions/_shared/google/README.md.
import { adminClient, webhookSecret } from '../_shared/google/config.ts';
import { supabaseDb } from '../_shared/google/db.ts';
import { HttpError, json } from '../_shared/google/http.ts';
import { handleWebhook } from '../_shared/google/webhook.ts';

let deps: Parameters<typeof handleWebhook>[1] | undefined;

Deno.serve((req: Request): Promise<Response> | Response => {
  try {
    if (!deps) {
      const db = supabaseDb(adminClient());
      deps = {
        secret: webhookSecret(),
        findCalendarByChannel: (id) => db.findCalendarByChannel(id),
        enqueueImport: (id) => db.enqueueImport(id),
      };
    }
    return handleWebhook(req, deps).catch((e) => {
      console.error(e);
      return json({ error: 'server_error' }, 500);
    });
  } catch (e) {
    console.error(e);
    return e instanceof HttpError ? json({ error: e.code, message: e.message }, e.status) : json({ error: 'server_error' }, 500);
  }
});
