---
layout: gridlay
title: "Projects"
permalink: /projects/
---

Here are a few things I’ve built. Click any card to open the live demo.


{% for p in site.projects %}<div class="col-md-4 mb-4"><a class="card shadow-lg h-100 text-decoration-none" href="{{ p.url | relative_url }}">{{ p.project_title }}</a>
</div>
{% endfor %}


