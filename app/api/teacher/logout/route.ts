import { assertSameOrigin, json, unexpected } from '@/lib/http';
import { createUserClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const supabase = await createUserClient();
    await supabase.auth.signOut();
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.logout');
  }
}
