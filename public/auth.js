/* ══════════════════════════════════════
   HenrysTV — Shared Auth Utilities
   Google OAuth via Supabase
══════════════════════════════════════ */

const SUPABASE_URL  = 'https://jyvdyspyiwithnioiirm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5dmR5c3B5aXdpdGhuaW9paXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTc4ODEsImV4cCI6MjA5NTYzMzg4MX0.FXw6g_OYK3XhNezluZT7US1P-qacmVCLk0RrPSjDqZg';

if (typeof window._sbShared === 'undefined') {
  window._sbShared = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      autoRefreshToken:  true,
      persistSession:    true,
      detectSessionInUrl: true   // auto-process OAuth hash/code on page load
    }
  });
}

async function sharedGetSession() {
  const { data: { session } } = await window._sbShared.auth.getSession();
  return session;
}

async function sharedSignOut() {
  await window._sbShared.auth.signOut();
  window.location.href = '/';
}

/* Update nav: show Studio btn if logged in, Login btn if not */
async function updateSharedNav() {
  try {
    const session     = await sharedGetSession();
    const loginBtn    = document.getElementById('navLoginBtn');
    const studioBtn   = document.getElementById('navStudioBtn');
    const logoutBtn   = document.getElementById('navLogoutBtn');

    if (session) {
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (studioBtn) studioBtn.style.display = '';
      if (logoutBtn) logoutBtn.style.display = '';
    } else {
      if (loginBtn)  loginBtn.style.display  = '';
      if (studioBtn) studioBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
    }
  } catch (e) {}
}

function markActiveNavLink() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = (a.getAttribute('href') || '').replace('.html', '');
    if (href === path || (href.length > 1 && path.startsWith(href))) {
      a.classList.add('active');
    }
  });
}

function toggleMobileNav() {
  const menu = document.getElementById('navMobileMenu');
  if (menu) menu.classList.toggle('open');
}

function initScrollTopBtn() {
  const btn = document.createElement('button');
  btn.id        = 'scrollTopBtn';
  btn.title     = 'Về đầu trang';
  btn.innerHTML = '↑';
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(btn);

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 280);
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
  updateSharedNav();
  markActiveNavLink();
  initScrollTopBtn();
});
