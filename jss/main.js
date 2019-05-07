$("button").click(function() {
    $('html,body').animate({
        scrollTop: $("resume").offset().top},
        'slow');
});