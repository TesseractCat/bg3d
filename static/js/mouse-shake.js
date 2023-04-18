
/*
 *	MouseShake.js
 *	Version 1.0
 *	Author: David Godzsak
 *  godzsakdavid@gmail.com
 *
 *	Copyright (c) 2015
 *	Licensed under the MIT license.
 *
 */


(function(){
	//Setup
		//object timestamp with coordinates
		Stamp=function(x,y,time){
			this.x=x;
			this.y=y;
			this.time=time;
		};
		//constants and global vars
		var stuff={                  //units
			moves:[],                  //set of Stamps
			deg:0,                     //degrees
			tick:new Date().getTime(), //time
			x:0,                       //coordinate x
			y:0,                       //coorddinate y
			refresh:80,                //milisecs
			shakeDeg:500,              //degrees
			lifeTime:500,              //milisecs
			l:false					   //mousemove indicator
		};

		//shake event
		var mouseshake = new Event('mouseshake',{
			'detail' : 'mouseshake fired',
			'bubbles': true,
    	'cancelable': true
		});

	//get gamma in triangles using law of cosines
	function gamma(st,nd,rd){
		//pythagoras
		var a=Math.sqrt(Math.pow(st.x-nd.x,2)+Math.pow(st.y-nd.y,2));
		var b=Math.sqrt(Math.pow(nd.x-rd.x,2)+Math.pow(nd.y-rd.y,2));
		var c=Math.sqrt(Math.pow(rd.x-st.x,2)+Math.pow(rd.y-st.y,2));
		var gam;

		if((a*b)==0){
			gam=0;
		}else{
			//law of cosines
			gam=180-Math.acos((Math.pow(a,2)+Math.pow(b,2)-Math.pow(c,2))/(2*a*b))*180/Math.PI;
		};
		return gam;
	};

	//update mouse position
	document.addEventListener('pointermove',function(e){
		//new position
		stuff.x=e.pageX;
		stuff.y=e.pageY;
		stuff.l=true;
	});

	//detects shake event
	detect=setInterval(function(){

			//add new Stamps
			if(stuff.l){
				//set up Stamp
				var now=new Date().getTime();
				var a=new Stamp(stuff.x,stuff.y,now);
				//add Stamp to set
				stuff.moves.push(a);
				stuff.l=false;  //mousemove indicator off
			};

			//delete old Stamps   -----------------might need some improvement.
			for(var i=0;i<stuff.moves.length;++i){
				if(now-stuff.moves[i].time>stuff.lifeTime){
					stuff.moves.splice(i, 1);
				};
			};


			//reset degrees so we can add them again
			stuff.deg=0;
			//add up gammas (deg=sum(gamma))
			if(stuff.moves.length>2){
				for(var i=2;i<stuff.moves.length;++i){
					stuff.deg+=gamma(stuff.moves[i],stuff.moves[i-1],stuff.moves[i-2]);
				};
			};

			//if degree exceeds shakeDeg shake event happens
			if(stuff.deg>stuff.shakeDeg){
				//fire
				document.dispatchEvent(mouseshake);

				//reset everything when shake happens
				stuff.deg=0;
				stuff.moves=[];
			};
	},stuff.refresh);
})();
