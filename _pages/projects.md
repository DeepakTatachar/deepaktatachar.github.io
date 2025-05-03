---
layout: gridlay
title: "Projects"
permalink: /projects/
---

Here are a few things I’ve built. Click on any to open the live demo or know more details.

<ul class="list-unstyled">
  {% for p in site.projects %}
    <li class="mb-2">
      <a href="{{ p.url | relative_url }}">
        {{ p.project_title | default: p.title }}
      </a>
    </li>
  {% endfor %}
</ul>
