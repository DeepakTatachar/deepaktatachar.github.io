---
layout: gridlay
title: "Projects"
permalink: /projects/
---

Here are a few things I’ve built. Click any card to open the live demo.

<ul class="list-unstyled">
  {% for p in site.projects %}
    <li class="mb-2">
      <a href="{{ p.url | relative_url }}">
        {{ p.project_title | default: p.title }}
      </a>
    </li>
  {% endfor %}
</ul>
