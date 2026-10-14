import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_URL, SUPABASE_KEY } from '@/lib/supabase/env';

const PUBLIC = ['/login', '/auth'];

/** Refreshes the session cookie on every request and sends signed-out visitors to /login. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getUser() checks the token with Supabase; never trust getSession() alone on the server.
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && !PUBLIC.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
