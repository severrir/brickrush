/* =========================================================================
   BRICK RUSH — landing.js
   Renders roles + live demand badges, hero "most wanted" stat, FAQ accordion.
   ========================================================================= */
(function () {
  const ROLES = window.BRICKRUSH_ROLES;
  const DEMAND = window.BRICKRUSH_DEMAND_LABEL;

  async function renderRoles() {
    const grid = document.getElementById('roles-grid');
    if (!grid) return;
    let demand = { scripter: 'open', modeler_animator: 'open', uiux: 'open' };
    try { demand = await window.Store.getDemand(); } catch (e) {}

    grid.innerHTML = ROLES.map(r => {
      const d = demand[r.id] || 'open';
      const dl = DEMAND[d];
      return `
      <a class="card card--glow role-card reveal" href="apply.html?role=${r.id}" data-no-sound>
        <div class="role-card__top">
          <div class="role-card__ico">${r.icon}</div>
          <span class="tag ${dl.cls}">${dl.text}</span>
        </div>
        <h3>${r.label}</h3>
        <p>${r.blurb}</p>
        <div class="role-card__skills">${r.skills.map(s => `<span class="tag">${s}</span>`).join('')}</div>
        <div class="role-card__foot">
          <span class="role-card__demand">Apply now</span>
          <span class="arrow">→</span>
        </div>
      </a>`;
    }).join('');

    // re-observe newly added reveals
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => ents.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
      grid.querySelectorAll('.reveal').forEach(e => io.observe(e));
    } else {
      grid.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
    }

    // Hero "live demand" stat
    const hot = ROLES.find(r => demand[r.id] === 'most_wanted');
    const stat = document.getElementById('stat-demand');
    if (stat) stat.textContent = hot ? hot.label : 'All roles';
  }

  function faq() {
    document.querySelectorAll('.faq-item__q').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const open = item.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => { renderRoles(); faq(); });
})();
