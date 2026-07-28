/* =======================================================================================

00. Preloader

01. Mobile Navigation

02. Scroll Spy

03. Animation Skills

04. Animation Typed

05. Animate Number Fun Fact

06. Ajax Contact Form js

07. Initialize WOW Js

08. Particles Config

09. Back To Top

10. App Version

=========================================================================================*/

(function($){

	"use strict";

	/*=========================================================================
		00. Preloader
	=========================================================================*/
	$(window).on('load', function(){
		$(".preloader").fadeOut(500);
	});

	/*=========================================================================
		01. Mobile Navigation
	=========================================================================*/
	$("#mobile-menu-open").on("click", function(e){
		e.preventDefault();
		$("body").addClass("open-menu");
	});

	$("#mobile-menu-close").on("click", function(e){
		e.preventDefault();
		$("body").removeClass("open-menu");
	});

	/*=========================================================================
		02. Scroll Spy
	=========================================================================*/
	$('a.smooth-scroll').on('click', function(event) {
		var $anchor = $(this);
		$('html, body').stop().animate({
			scrollTop: $($anchor.attr('href')).offset().top - 0
		}, 1000);
		event.preventDefault();
	});

	var lastId,
		topMenu = $(".menu-list"),
		menuItems = topMenu.find("a"),
		scrollItems = menuItems.map(function(){
			var item = $($(this).attr("href"));
			if(item.length) {
				return item;
			}
		});

	menuItems.on('click',function(e){
		var href = $(this).attr("href"),
			offsetTop = href === "#intro" ? 0 : $(href).offset().top;
		$('html, body').stop().animate({
			scrollTop: offsetTop
		}, 1000);
		e.preventDefault();
	});

	$(window).on("scroll", function(){
		var fromTop = $(this).scrollTop() + 60,
			cur = scrollItems.map(function(){
					if ($(this).offset().top < fromTop)
					return this;
				});
			cur = cur[cur.length-1];
		var id = cur && cur.length ? cur[0].id : "";
		if (lastId !== id) {
			lastId = id;
			menuItems
				.parent().removeClass("active")
				.end().filter("[href=#"+id+"]").parent().addClass("active");
		}
	});

	/*=========================================================================
		03. Animation Skills
	=========================================================================*/
	$(".about").waypoint(function(){
		$(".progress-bar").css("width",function(){
			return $(this).attr("aria-valuenow")+"%"
		});
	});

	/*=========================================================================
		04. Animation Typed
	=========================================================================*/
	$(".passion").typed({
		strings: ["Web Developer.", "Back-end Developer." ],
		typeSpeed: 100,
		loop: true,
	});

	/*=========================================================================
		05. Animate Number Fun Fact
	=========================================================================*/
	$('.fun-counter').counterUp({ delay: 3, time: 500 });

	/*=========================================================================
		06. Ajax Contact Form js
	=========================================================================*/
	// init the validator
	var $contactForm = $('#contactForm'),
		$sendBtn = $contactForm.find('button[type="submit"]'),
		sendBtnText = $sendBtn.text(),
		isSending = false;

	$contactForm.validator();

	function getCsrfCookie(){
		var match = document.cookie.match(/(?:^|;\s*)wj_csrf=([^;]*)/);
		return match ? decodeURIComponent(match[1]) : "";
	}

	// prefetch csrf token on page load
	$.get("/api/csrf");

	function resetSendBtn(){
		$sendBtn
			.prop('disabled', false)
			.removeClass('sending sent')
			.text(sendBtnText);
	}

	// when the form is submitted
	$contactForm.on('submit', function (e) {

		// block duplicate submit while sending
		if (isSending) {
			e.preventDefault();
			return false;
		}

		// if the validator does not prevent form submit
		if (!e.isDefaultPrevented()) {
			var $form = $(this),
				url = $form.attr('action'),
				csrf = getCsrfCookie();

			// token missing, fetch then retry
			if (!csrf) {
				e.preventDefault();
				$.get("/api/csrf").always(function(){
					if (getCsrfCookie()) {
						$form.trigger("submit");
					}
				});
				return false;
			}

			isSending = true;
			$('.message-success, .message-error').hide();
			$sendBtn
				.prop('disabled', true)
				.addClass('sending')
				.text('正在发送');

			// POST values in the background the the script URL
			$.ajax({
				type: "POST",
				url: url,
				data: $form.serialize() + "&csrf=" + encodeURIComponent(csrf),
				dataType:"json",
				success: function (data){
					if(data.code == 0){
						$sendBtn.removeClass('sending').addClass('sent').text('发送成功');
						$('.message-success').fadeIn();
						$contactForm[0].reset();
						setTimeout(function(){
							resetSendBtn();
							isSending = false;
						}, 2000);
					}else{
						// csrf token expired or invalid, refresh it
						if (data.code == -6) {
							$.get("/api/csrf");
						}
						$('.message-error').html(data.tips);
						$('.message-error').fadeIn();
						resetSendBtn();
						isSending = false;
					}
				},
				error: function(){
					$('.message-error').fadeIn();
					resetSendBtn();
					isSending = false;
				}
			});
			return false;
		}
	});

	/*=========================================================================
		07. Initialize WOW Js
	=========================================================================*/
	var wow = new WOW({
		mobile: false
	});
	wow.init();

	/*=========================================================================
		08. Particles Config
	=========================================================================*/
	particlesJS('particles-js',

	{
	  "particles": {
	    "number": {
	      "value": 50,
	      "density": {
	        "enable": true,
	        "value_area": 900
	      }
	    },
	    "color": {
	      "value": "#ffffff"
	    },
	    "shape": {
	      "type": "circle",
	      "stroke": {
	        "width": 0,
	        "color": "#000000"
	      },
	      "polygon": {
	        "nb_sides": 5
	      },
	      "image": {
	        "src": "img/github.svg",
	        "width": 100,
	        "height": 100
	      }
	    },
	    "opacity": {
	      "value": 0.5,
	      "random": false,
	      "anim": {
	        "enable": false,
	        "speed": 1,
	        "opacity_min": 0.1,
	        "sync": false
	      }
	    },
	    "size": {
	      "value": 3,
	      "random": true,
	      "anim": {
	        "enable": false,
	        "speed": 40,
	        "size_min": 0.1,
	        "sync": false
	      }
	    },
	    "line_linked": {
	      "enable": true,
	      "distance": 150,
	      "color": "#ffffff",
	      "opacity": 0.4,
	      "width": 1
	    },
	    "move": {
	      "enable": true,
	      "speed": 6,
	      "direction": "none",
	      "random": false,
	      "straight": false,
	      "out_mode": "out",
	      "bounce": false,
	      "attract": {
	        "enable": false,
	        "rotateX": 600,
	        "rotateY": 1200
	      }
	    }
	  },
	  "interactivity": {
	    "detect_on": "canvas",
	    "events": {
	      "onhover": {
	        "enable": true,
	        "mode": "repulse"
	      },
	      "onclick": {
	        "enable": true,
	        "mode": "push"
	      },
	      "resize": true
	    },
	    "modes": {
	      "grab": {
	        "distance": 400,
	        "line_linked": {
	          "opacity": 1
	        }
	      },
	      "bubble": {
	        "distance": 400,
	        "size": 40,
	        "duration": 2,
	        "opacity": 8,
	        "speed": 3
	      },
	      "repulse": {
	        "distance": 200,
	        "duration": 0.4
	      },
	      "push": {
	        "particles_nb": 4
	      },
	      "remove": {
	        "particles_nb": 2
	      }
	    }
	  },
	  "retina_detect": true
	}
	);

	/*=========================================================================
		09. Back To Top
	=========================================================================*/
	var $backToTop = $("#back-to-top");

	$(window).on("scroll", function(){
		$backToTop.toggleClass("visible", $(this).scrollTop() > 300);
	});

	$backToTop.toggleClass("visible", $(window).scrollTop() > 300);

	$backToTop.on("click", function(e){
		e.preventDefault();
		$("html, body").stop().animate({ scrollTop: 0 }, 800);
	});

	/*=========================================================================
		10. App Version
	=========================================================================*/
	(function(){
		var $version = $("#app-version");
		if (!$version.length) { return; }
		var build = window.__APP_BUILD__;
		if (build && build.display) {
			$version.text(build.display);
			$version.attr("title", "Build " + (build.build || "") + " · " + (build.generatedAt || ""));
		} else {
			$version.text("dev").attr("title", "本地开发环境");
		}
	})();

}(jQuery));
