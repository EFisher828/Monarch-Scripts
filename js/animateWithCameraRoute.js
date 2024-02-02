import loadEncoder from 'https://unpkg.com/mp4-h264@1.0.7/build/mp4-encoder.js';
import {simd} from "https://unpkg.com/wasm-feature-detect?module";

// Animation sections - used to split the video render into multiple pieces so the browser doesn't crash
// Sections have an assortment of starting variables (ex. s_center), ending variables (ex. e_bearing), camera variables (ex. s_c_altitude), and animation variables (ex. a_end)
const sections = {
  0: {
    "fn": intro,
    "s_center": [-122.259486581503182, 37.798278454894493],
    "s_zoom": 6.438754836859259,
    "s_pitch": 53.5,
    "s_bearing": 0,
    "e_center": [-122.259486581503182, 37.798278454894493],
    "e_zoom": 16,
    "e_pitch": 65,
    "e_bearing": 45,
    "a_duration": 12000
  },
  1: {
    "fn": routeAnimation,
    "s_center": [-122.25948658150321, 37.798278454894486],
    "s_zoom": 16,
    "s_pitch": 65,
    "s_bearing": 45,
    "s_c_altitude": 436.95847826607377,
    "s_c_coords": [-122.2669122760089, 37.792410635381856],
    "a_start": 0/26.2,
    "a_end": 5/26.2,
  },
  2: {
    "fn": routeAnimation,
    "s_center": [-122.25068475741566, 37.82853491738399],
    "s_zoom": 16.446490603235397,
    "s_pitch": 59.76668048557997,
    "s_bearing": 66.09201190219301,
    "s_c_altitude": 437.09911409899206,
    "s_c_coords": [-122.25740044419794, 37.82618341611892],
    "a_start": 5/26.2,
    "a_end": 10/26.2,
  },
  4: {
    "fn": routeAnimation,
    "s_center": [-122.27758197572064, 37.80464745263285],
    "s_zoom": 16.442523940889114,
    "s_pitch": 61.182189053434165,
    "s_bearing": 45,
    "a_start": 10/26.2,
    "a_end": 15/26.2,
  }
}

// Assign the section to be rendered
const animationSection = sections[0]

// A function that can force the script to pause for a period of time (in ms), used later
const delay = ms => new Promise(res => setTimeout(res, ms));

// Mapbox API key
mapboxgl.accessToken = "pk.eyJ1IjoiZXhwbG9yZWZhbGwiLCJhIjoiY2xsMnluNmlsMmwwMzNxcGRrOXFpaXRjYSJ9.1CysSOnixhO2ndvCPmb7-Q";

// Definition of map object, with starting variables for the assigned section
const map = window.map = new mapboxgl.Map({
    container: "map",
    projection: "globe",
    style: 'mapbox://styles/mapbox/standard',
    center: animationSection['s_center'],
    zoom: animationSection['s_zoom'],
    pitch: animationSection['s_pitch'],
    bearing: animationSection['s_bearing'],
});

// A function that returns the json format of a point along a line
const pointOnLine = (timestamp,path) => {
  // Calculate the length of the line
  const pathDistance = turf.lineDistance(path);

  // Using the timestamp (linear value between 0 and 1, where 1 is the end of the animation), fetch the coordinates of the current point
  const alongPath = turf.along(path, pathDistance * timestamp).geometry.coordinates;

  // Return a json object with the current point coords
  return {
    'type': 'Point',
    'coordinates': alongPath
  };
}

// A function that contains necessary infrastructure and the animation function
async function routeAnimation() {
  // Define a variable with camera position and orientation options
  let camera = map.getFreeCameraOptions();

  // Animation length (ms) - the longer the animation, the smoother the animation will appear
  let animationTime = 1000000;

  // Fetch the geojson of the course route to be animated
  const trackGeojson = await fetch("./data/Route-V4.geojson").then((d) =>
    d.json()
  );


  // Fetch the geojson of the camera route to be animated
  const cameraGeojson = await fetch("./data/Camera-Route-V2.geojson").then((d) =>
    d.json()
  );

  // Define the initial point along the course
  let pt = pointOnLine(animationSection['a_start']*animationTime, trackGeojson.features[0]);

  // Define style parameters to create a glow around the point
  let styleDic = {
    0: {
      'ptcolor': '#f5d81d',
      'ptradius': 30,
      'ptopacity': 1,
      'ptblur': 3,
      'ptstrokecolor': 'white',
      'ptstrokewidth': 0
    },
    1: {
      'ptcolor': '#f5d81d',
      'ptradius': 20,
      'ptopacity': 1,
      'ptblur': 1,
      'ptstrokecolor': 'white',
      'ptstrokewidth': 0
    },
    2: {
      'ptcolor': '#f5ad1d',
      'ptradius': 6,
      'ptopacity': 1,
      'ptblur': 0,
      'ptstrokecolor': 'white',
      'ptstrokewidth': 3
    }
  }

  // Add the initial point - loop to create three points with different style in same location - later referred to as animation point
  let circleLayerIds = ['circle-layer1','circle-layer2','circle-layer3'];
  for (let id in circleLayerIds){
    map.addLayer({
        'id': circleLayerIds[id],
        'type': 'circle',
        'source': {
            'type': 'geojson',
            'data': pt
        },
        'paint': {
            'circle-radius': styleDic[id]['ptradius'],
            'circle-color': styleDic[id]['ptcolor'],
            'circle-opacity': styleDic[id]['ptopacity'],
            'circle-blur': styleDic[id]['ptblur'],
            'circle-stroke-color': styleDic[id]['ptstrokecolor'],
            'circle-stroke-width': styleDic[id]['ptstrokewidth']
        },
    });
  }

  // Predefine a bunch of variables that will be used in the animation
  let firstPass = true
  let timestamp_start;
  let timestamp_adj;
  let cameraAltitude;
  let cameraPosition;
  let runnerPosition;
  let bearing;
  let offset;
  let offsetLine;
  let pitch;

  // A function that runs the animation - it calls itself at the end to trigger another frame unless a condition is met. The evaluated condition is whether or not the animation length has been met (defined earlier).
  const animateMarker = async (timestamp) => {
    // If it's the first frame, get the timestamp and camera altitude
    if (firstPass === true) {
      timestamp_start = parseFloat(timestamp)
      cameraAltitude =  camera._position.z*31630823.17
      firstPass = false
    }

    // Adjust the timestamp with the start time - ensures the animation doesn't get wonky if there's waiting time prior to the animation being triggered
    timestamp_adj = performance.now() - timestamp_start

    // Fetch the coordinate along the course route that corresponds with the position in the animations and update the point layer geometry
    // timestamp_adj/animationTime will be a value between 0 and 1, corresponding to how far into the animation the frame is (ex. first frame is roughly 0/100000)
    // animationSection['a_start'] is a time offset defined for each animation section - basically if the animation starts at the 5 mile mark, then add 5/26.2 to the value of timestamp_adj/animationTime
    for (let i in circleLayerIds) {
      map.getSource(circleLayerIds[i]).setData(pointOnLine((timestamp_adj/animationTime)+animationSection['a_start'], trackGeojson.features[0]))
    }

    // The data that corresponds to a ratio of less than (timestamp_adj/animationTime)+animationSection['a_start'] is yellow (traveled portion of the line)
    // The data that corresponds to a ratio of greater than or equal to (timestamp_adj/animationTime)+animationSection['a_start'] is black (untravelled portion of the line)
    map.setPaintProperty("line", "line-gradient", [
      "step",
      ["line-progress"],
      "yellow",
      (timestamp_adj/animationTime)+animationSection['a_start']-0.0001,
      "black"
    ]);

    // Fetch the position of the point (runnerPosition) and camera (cameraPosition) from their respective geojson lines (defined earlier)
    cameraPosition = pointOnLine((timestamp_adj/animationTime)+animationSection['a_start'], cameraGeojson.features[0]).coordinates
    runnerPosition = pointOnLine((timestamp_adj/animationTime)+animationSection['a_start'], trackGeojson.features[0]).coordinates

    // The angle from north that the runnerPosition is found from the cameraPosition
    bearing = Math.atan((runnerPosition[0] - cameraPosition[0])/(runnerPosition[1]-cameraPosition[1])) * (180/Math.PI)

    // Some geometry that makes this work - the second else if is redundant, but I'm leaving it in case there's a geometric situation I haven't stumbled upon yet that needs correcting
    if ((runnerPosition[1] - cameraPosition[1]) < 0) {
      bearing = 180 + bearing
    } else if ((runnerPosition[0] - cameraPosition[0]) < 0) {
      bearing = bearing
    }

    // For some reason this is necessary to make the animation line up - couldn't tell you why
    bearing = bearing - 6.68

    // Create a line between the runnerPosition and cameraPosition whose length can be easily measured
    offsetLine = {
      geometry: {
        coordinates: [runnerPosition, cameraPosition],
        type: "LineString"
      },
      type: "Feature"
    }

    // Length of above line
    offset = turf.length(offsetLine) * 1000

    // The angle from vertical at which the camera is pitched - calculated to keep animated point in middle of screen
    pitch = Math.atan(offset/cameraAltitude) * (180/Math.PI)

    // Set the camera pitch and bearing that have been calculated for this frame
    camera.setPitchBearing(pitch, bearing);

    // Set the camera position and altitude that have been calculated for this frame (altitude is constant for now, defined at the beginning)
    camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        cameraPosition,
        cameraAltitude
    );

    // Commit changes to camera variable
    map.setFreeCameraOptions(camera);

    // If the anaimation has not reached the user defined animation length, generate another frame
    if ((timestamp_adj+(animationSection['a_start']*animationTime)) < (animationTime*animationSection['a_end'])) {
      // Request the next frame of the animation.
      requestAnimationFrame(animateMarker);
    }
  }
  // Start the animation
  animateMarker(performance.now());
}

// Once the map style has loaded (necessary), adjust the style and layers of the map - time of day, labels, atmosphere, fog, terrain, etc
map.on('style.load', () => {
  map.setConfigProperty('basemap', 'lightPreset', 'day');
  map.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
  map.setConfigProperty('basemap', 'showTransitLabels', false);
  map.setFog({
      'color': 'rgb(186, 210, 235)', // Lower atmosphere
      'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
      'horizon-blend': 0.02, // Atmosphere thickness (default 0.2 at low zooms)
      'space-color': 'rgb(11, 11, 25)', // Background color
      'star-intensity': 0.6 // Background star brightness (default 0.35 at low zoooms )
  });

  // If it is the first section (a zoom in from above), wait until zoom level 12.5 to render a soft, wide white line beneath the course line. Else, render immediately.
  if (animationSection === sections[0]) {
    let toggle = false
    map.on('zoom', function(e){
      const currentZoom = map.getZoom()
      if (currentZoom > 12.5 && toggle === false){
        map.addLayer({
          'id': 'line-glow',
          'type': 'line',
          'slot': 'top',
          'source': {
            'type': 'geojson',
            'data': './data/Route-V4.geojson'
          },
          'paint': {
            'line-width': 50,
            'line-color': 'white',
            'line-blur': 20
          }
        });
      }
    })
  } else {
    map.addLayer({
      'id': 'line-glow',
      'type': 'line',
      'slot': 'top',
      'source': {
        'type': 'geojson',
        'data': './data/Route-V4.geojson'
      },
      'paint': {
        'line-width': 50,
        'line-color': 'white',
        'line-blur': 20
      }
    });
  }

  // Add the course route geojson and style with the style that is used in the animation - note 0 in setPaintProperty, so no yellow, all black
  map.addLayer({
    'type': "line",
    'source': {
      'type': "geojson",
      'lineMetrics': true,
      'data': './data/Route-V4.geojson',
    },
    'id': "line",
    'paint': {
      "line-color": "rgba(0,0,0,0)",
      "line-width": 8,
      "line-opacity": 0.9,
    },
    'layout': {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.setPaintProperty("line", "line-gradient", [
    "step",
    ["line-progress"],
    "yellow",//rgba(0,0,0,0)
    0,
    "black"//"rgba(0, 0, 0, 0)",
  ])

  // Add colored points at the beginning and end of the course
  map.addLayer({
    'id': 'endsLayer',
    'type': 'circle',
    'source': {
      'type': 'geojson',
      'data': 'https://raw.githubusercontent.com/EFisher828/geojson-store/main/Points-V2.geojson'
    },
    'paint': {
      'circle-radius': 6,
      'circle-stroke-color': 'white',
      'circle-stroke-width': 3,
      'circle-color': [
          'match',
          ['get', 'OBJECTID'],
          1, 'green',  // OBJECTID 1: green color
          2, 'red',    // OBJECTID 2: red color
          'black'      // Default color if OBJECTID doesn't match any case
      ],
    }
  });
})

// Function used at the beginning (section 0) to zoom into the course from above
async function intro() {
  let finalLngLat = [-122.259486581503182, 37.798278454894493]

    map.flyTo({
      center: finalLngLat,
      zoom: 16,
      bearing: 45,
      pitch: 65,
      duration: 12000,//12000, // Animate over 12 seconds
      essential: true
    });
}

// Function that calls the animation functions
async function animate() {

    // Call the animation function for the defined section
    animationSection['fn']()

    // Wait for the map to stop moving
    await map.once('idle')

    // Fairly certain this will be useful at some point so haven't deleted
    // await delay(2000)
    //
    // await map.once('idle')

    // Print the camera info at the end of the animation - used for creating the next section's variables
    let camera = map.getFreeCameraOptions();
    console.log(`Center: ${map.getCenter()}`);
    console.log(`Cam Alt: ${camera._position.z*31630823.17}`)
    console.log(`Cam Coords: ${camera._position.toLngLat()}`)
    console.log(`Zoom: ${map.getZoom()}`);
    console.log(`Pitch: ${map.getPitch()}`);
    console.log(`Bearing: ${map.getBearing()}`);
}

// When the map loads, add terrain and begin animation + recording
map.on('load', async () => {
    map.addSource('dem', {type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1'});
    map.setTerrain({source: 'dem', exaggeration: 1.5});

    // Wait to seconds for terrain to render properly
    await delay(2000)

    // Uncomment to fine-tune animation without recording:
    // animate(); return;

    // Recording code below isn't mine, and I can't explain all the details... but it works!
    // Don't forget to enable WebAssembly SIMD in chrome://flags for faster encoding
    const supportsSIMD = await simd();

    // Initialize H264 video encoder
    const Encoder = await loadEncoder({simd: supportsSIMD});

    const gl = map.painter.context.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    const encoder = Encoder.create({
        width,
        height,
        fps: 60,
        kbps: 64000,
        rgbFlipY: true
    });

    // Stub performance.now for deterministic rendering per-frame (only available in dev build)
    let now = performance.now();
    mapboxgl.setNow(now);

    const ptr = encoder.getRGBPointer(); // keep a pointer to encoder WebAssembly heap memory

    function frame() {
        // Increment stub time by 16.6ms (60 fps)
        now += 1000 / 60;
        mapboxgl.setNow(now);

        const pixels = encoder.memory().subarray(ptr); // get a view into encoder memory
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); // read pixels into encoder
        encoder.encodeRGBPointer(); // encode the frame
    }

    map.on('render', frame); // set up frame-by-frame recording

    await animate(); // run all the animations

    // Stop recording
    map.off('render', frame);
    mapboxgl.restoreNow();

    // Download the encoded video file
    const mp4 = encoder.end();
    const anchor = document.createElement("a");
    anchor.href =  URL.createObjectURL(new Blob([mp4], {type: "video/mp4"}));
    anchor.download = "mapbox-gl";
    anchor.click();
});
