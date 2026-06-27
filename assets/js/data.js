/* =========================================================================
   BRICK RUSH — data.js
   Shared, static content used by landing + apply + admin.
   ========================================================================= */
var ICO = (paths) => `<svg class="ico" viewBox="0 0 24 24" stroke="url(#ig)">${paths}</svg>`;

window.BRICKRUSH_ROLES = [
  {
    id: 'scripter', label: 'Scripter',
    icon: ICO('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>'),
    blurb: 'Systems, gameplay, optimization. You turn ideas into living mechanics in Luau.',
    skills: ['Luau', 'OOP', 'Networking', 'Optimization'],
    questionLabel: 'Hardest system you’ve scripted',
  },
  {
    id: 'modeler_animator', label: 'Modeler & Animator',
    icon: ICO('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>'),
    blurb: 'Meshes, props, rigs, motion. You give the world its shape and make it move.',
    skills: ['Blender', 'Modeling', 'Rigging', 'Animation'],
    questionLabel: 'Your modeling / animation specialty',
  },
  {
    id: 'uiux', label: 'UI/UX Designer',
    icon: ICO('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
    blurb: 'Interfaces players feel before they read. Clean, fast, on-brand HUDs and menus.',
    skills: ['Figma', 'UI', 'UX', 'Layout'],
    questionLabel: 'Your design philosophy in one line',
  },
];

window.BRICKRUSH_DEMAND_LABEL = {
  most_wanted: { text: 'Most wanted', cls: 'tag--hot' },
  open: { text: 'Open', cls: 'tag--open' },
  closed: { text: 'Closed', cls: 'tag' },
};
