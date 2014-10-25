/**
 * The number of miles that a facility must be within driving distance of a
 * specified location.
 * @type {number}
 */
var THRESHOLD_MILES = 40;

/**
 * An icon for showing a VA facility.
 * @type {google.maps.Icon}
 */
var FACILITY_ICON = {
  url: 'http://www.mirecc.va.gov/coaching/images/icon_omhs.gif',
  scaledSize: new google.maps.Size(15, 15),
  anchor: new google.maps.Point(7, 7)
};

/**
 * Returns true if the facility is a qualified facility. Typically this means
 * that it is either a VA Medical Center or a Community Based Outpatient Clinic,
 * but this may be customized.
 * TODO(sraub): Allow for selection of only Medical Centers.
 */
function isQualifiedFacility(facility) {
  return facility.properties.PRIM_SVC == 'VAMC' ||
      facility.properties.PRIM_SVC == 'CBOC';
}

var facilityMarkers = [];
function showAllFacilities() {
  for (var i = 0; i < FACILITIES.length; ++i) {
    var facility = FACILITIES[i];
    if (!isQualifiedFacility(facility)) {
      continue;
    }
    var facilityLocation = new google.maps.LatLng(
        facility.properties.G_LAT, facility.properties.G_LON);
    var diameter = facility.properties.PRIM_SVC == 'CBOC' ? 8 : 12;
    new google.maps.Marker({
      map: map,
      position: facilityLocation,
      icon: {
        url: 'img/light-blue-circle-1.png',
        scaledSize: new google.maps.Size(diameter, diameter),
        anchor: new google.maps.Point(diameter / 2, diameter / 2)
      },
      zIndex: 1
    });
  }
}

/**
 * Extracts the address from the facility.
 * @param {Object} facility The "properties" object of a facility feature.
 * @return {Array.<string>} The address components of the facility.
 */
function getAddress(facility) {
  var address = [];
  if (facility.properties.S_ADD1) {
    address.push(facility.properties.S_ADD1);
  }
  if (facility.properties.S_ADD2) {
    address.push(facility.properties.S_ADD2);
  }
  if (facility.properties.S_ADD3) {
    address.push(facility.properties.S_ADD3);
  }
  var cityState = [];
  if (facility.properties.S_CITY) {
    cityState.push(facility.properties.S_CITY);
  }
  if (facility.properties.S_STATE) {
    cityState.push(facility.properties.S_STATE);
  }
  if (cityState.length > 0) {
    address.push(cityState.join(', '));
  }
  return address;
}

function metersToMiles(meters) {
  return meters / 1609.34;
}

/**
 * Determines whether the given location is eligible for private patient care or
 * not, by determining whether it is within THRESHOLD_MILES driving miles of a
 * VA medical facility. Calls "callback" with all of the facilities that are
 * within that distance.
 * @param {google.maps.LatLng} location The location for which to check
 *     eligibility.
 * @param {function(Array<Object>, number)} callback The function to call with
 *     information about the facilities within 40 miles of "location" was
 *     passed into checkEligibility.
 */
function checkEligibility(location, callback) {
  var facilitiesWithDistance = [];
  var destinations = [];
  // Compute the distance between the location and all of the facilities.
  // TODO(sraub): Only check facilities that are in the same VISN as "location".
  for (var i = 0; i < FACILITIES.length; ++i) {
    var facility = FACILITIES[i];
    if (!isQualifiedFacility(facility)) {
      continue;
    }
    var facilityLocation = new google.maps.LatLng(
        facility.properties.G_LAT, facility.properties.G_LON);
    var crow = metersToMiles(
        google.maps.geometry.spherical.computeDistanceBetween(
            facilityLocation, location));
    if (crow < THRESHOLD_MILES) {
      facilitiesWithDistance.push({
        facility: facility,
        location: facilityLocation,
        name: facility.properties.STA_NAME,
        address: getAddress(facility),
        crowDistance: crow
      });
      destinations.push(facilityLocation);
    }
  }
  if (facilitiesWithDistance.length == 0) {
    // There are no facilities within 40 miles, as the crow flies.
    callback([]);
    return;
  }
  // TODO(sraub): Add a parameter to allow to use only crow-flies logic.
  // Use the DistanceMatrixService to get the driving distance between the
  // location and each of the facilities that is within 40 miles as the crow
  // flies.
  var facilitiesWithinDistance = [];
  var service = new google.maps.DistanceMatrixService();
  service.getDistanceMatrix({
    origins: [location],
    destinations: destinations,
    travelMode: google.maps.TravelMode.DRIVING,
    unitSystem: google.maps.UnitSystem.IMPERIAL,
    durationInTraffic: false,
    avoidHighways: false,
    avoidTolls: false
  }, function(response, status) {
    // Check each destination to see if the driving distance is within 40 miles.
    // If it is, then store it in facilitiesWithinDistance.
    for (var i = 0; i < response.rows[0].elements.length; ++i) {
      var distance = response.rows[0].elements[i].distance;
      if (metersToMiles(distance.value) < THRESHOLD_MILES) {
        var facility = facilitiesWithDistance[i];
        facility.distance = distance;
        facilitiesWithinDistance.push(facility);
      }
    }
    // Sort the facilities that are within 40 miles by their distance.
    facilitiesWithinDistance.sort(function(a, b) {
      return a.distance.value - b.distance.value;
    });
    callback(facilitiesWithinDistance);
  });
}

/**
 * Updates the map and results box with information about each of the facilities
 * within 40 miles of the specified location.
 * @param {Array.<Object>} facilities An array of the facilities within 40
 *     driving miles of the specified location.
 * @param {google.maps.LatLngBounds} bounds The preferred bounds of the
 *     specified location.
 */
function updateFacilities(facilities, bounds) {
  // Remove all the facility markers from the map so that we only show the ones
  // within 40 driving miles.
  clearMap();

  // Update the text below the map to say how many facilities are within 40
  // miles and what those facilities are.
  // TODO(sraub): This needs to be more beautiful.
  var numFacilities = document.getElementById('num-facilities');
  var num = facilities.length;
  numFacilities.innerText = 'There ' +
    (num == 1 ? 'is one facility' :
     'are ' + (num == 0 ? 'no' : num) + ' facilities') +
    ' within ' + THRESHOLD_MILES + ' miles.';
  numFacilities.style.display = '';

  if (num == 0) {
    document.getElementById('eligible').style.display = '';
  } else {
    document.getElementById('not-eligible').style.display = '';
  }

  var facilityDiv = document.getElementById('facilities');
  var innerHTML = '';
  for (var i = 0; i < facilities.length; ++i) {
    var facility = facilities[i];
    innerHTML += '<div class="facility">' +
      '<div class="facility-name">' + facility.name + '</div>' +
      '<div class="facility-address">' + facility.address.join('<br>') +
      ' - (' + facility.distance.text + ')</div>';
      '</div>';

    var diameter = facility.facility.properties.PRIM_SVC == 'VAMC' ? 16 : 12;
    facilityMarkers.push(new google.maps.Marker({
      icon: {
        url: 'img/blue-circle.png',
        scaledSize: new google.maps.Size(diameter, diameter),
        anchor: new google.maps.Point(diameter / 2, diameter / 2)
      },
      zIndex: 0,
      position: facility.location,
      map: map,
      title: facility.name
    }));
    bounds.extend(facility.location);
  }
  facilityDiv.innerHTML = innerHTML;

  // Fit the map to the place's viewport. This will be reset to include
  // all of the facilities that are within a 40 mile drive of the
  // selected place.
  map.fitBounds(bounds);
}

/**
 * Clears the map of all of the facility markers.
 */
function clearMap() {
  for (var i = 0; i < facilityMarkers.length; ++i) {
    facilityMarkers[i].setMap(null);
  }
  facilityMarkers = [];
}

/**
 * Check the eligibility of the selected location and show relevant information
 * on the map.
 * @param {google.maps.Geometry} geometry The geometry of the selected location.
 * @param {google.maps.Marker} marker The marker to position on the map.
 */
function showPlace(geometry, marker) {
  // Move the marker to the selected place.
  // TODO(sraub): Replace the default icon.
  marker.setPosition(geometry.location);
  marker.setMap(map);

  // Check if this location is eligible to receive private health cover.
  checkEligibility(geometry.location, function(facilities) {
    var bounds = geometry.viewport || new google.maps.LatLngBounds(
        geometry.location, geometry.location);
    updateFacilities(facilities, bounds);
  });
}

var map;
function initializeMap() {
  map = new google.maps.Map(
      document.getElementById('map-canvas'), {
        center: {lat: 37.9209, lng: -97.1284},
        zoom: 3
      });
  // Show all the facilities, just for kicks.
  showAllFacilities();
}

var autocomplete;
function initializeAutocomplete() {
  function updateRegion() {
    var region = document.getElementById('region').value;
    autocomplete.setOptions({
      componentRestrictions: {country: region}
    });
  }

  autocomplete = new google.maps.places.Autocomplete(
    document.getElementById('address'), {
      types: ['geocode']
    });
  updateRegion();
  autocomplete.bindTo('bounds', map);

  // Set up the autocomplete input to place a marker on the map at the
  // selected location and then to check eligibility of that location.
  var marker = new google.maps.Marker({
    clickable: false
  });
  // TODO(sraub): Handle the user pressing enter.
  google.maps.event.addListener(
      autocomplete, 'place_changed', function() {
    var place = autocomplete.getPlace();
    if (!place || !place.geometry) {
      // TODO(sraub): Provide a warning to the user.
      window.console.log('Place not found', place.name);
      marker.setMap(null);  // Hide the marker.
      return;
    }
    showPlace(place.geometry, marker);
  });
}
