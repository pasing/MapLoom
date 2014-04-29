(function() {
  var module = angular.module('loom_table_view_directive', []);

  module.filter('table', function() {
    return function(input, filter) {
      var out = '';

      if (input) {
        //converting the input and filter strings to lower case for a case insensitive filtering
        var inputLower = input.toLowerCase(),
            filterLower = filter.toLowerCase();
        if (inputLower.indexOf(filterLower) !== -1) {
          out = input;
        }
      }
      return out;
    };
  });

  function clone(obj) {
    // Handle the 3 simple types, and null or undefined
    if (obj == null || typeof obj != 'object') {
      return obj;
    }

    var copy;

    // Handle Array
    if (obj instanceof Array) {
      copy = [];
      for (var i = 0, len = obj.length; i < len; i++) {
        copy[i] = clone(obj[i]);
      }
      return copy;
    }

    // Handle Object
    if (obj instanceof Object) {
      copy = {};
      for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) {
          copy[attr] = clone(obj[attr]);
        }
      }
      return copy;
    }
  }

  module.directive('loomTableView',
      function(tableFilter, mapService, $http, tableViewService, featureManagerService, dialogService, $translate) {
        return {
          restrict: 'C',
          templateUrl: 'tableview/partial/tableview.tpl.html',
          link: function(scope, element) {

            function resizeModal() {
              var containerHeight = angular.element('#table-view-window .modal-content')[0].clientHeight;
              var headerHeight = angular.element('#table-view-window .modal-header')[0].clientHeight;

              var contentHeight = containerHeight - headerHeight;
              //if conatainerHeight is 0 then the modal is closed so we shouldn't bother resizing
              if (containerHeight === 0) {
                return;
              }

              element[0].parentElement.style.height = contentHeight + 'px';

              var bodyHeight = contentHeight;// - angular.element('#table-view-window .modal-footer')[0].clientHeight;
              angular.element('#table-view-window .modal-body')[0].style.height = bodyHeight + 'px';

              //resize the panel to account for the filter text box and padding
              angular.element('#table-view-window .panel')[0].style.height = bodyHeight - 134 + 'px';
            }

            angular.element('#table-view-window').on('shown.bs.modal', function() {
              resizeModal();
              $.bootstrapSortable();
            });

            $(window).resize(resizeModal);

            scope.toggleWordWrap = function() {
              var tableElement = angular.element('#table-view-window .table-hover')[0];

              if (tableElement.style.whiteSpace !== 'normal') {
                tableElement.style.whiteSpace = 'normal';
              } else {
                tableElement.style.whiteSpace = 'nowrap';
              }
            };

            scope.rows = clone(tableViewService.rows);
            scope.attributes = tableViewService.attributeNameList;
            scope.restrictions = tableViewService.restrictionList;

            scope.filterText = '';
            scope.filteringTable = false;

            scope.filterTable = function() {
              if (scope.filteringTable) {
                scope.filterText = '';
              }

              if (scope.filterText === '') {
                scope.clearFilter();
                return;
              }

              scope.filteringTable = true;
              for (var feat in scope.rows) {
                scope.rows[feat].visible = false;

                for (var prop in scope.rows[feat].feature.properties) {
                  if (tableFilter(scope.rows[feat].feature.properties[prop], scope.filterText) !== '') {
                    scope.rows[feat].visible = true;
                    break;
                  }
                }
              }
            };

            scope.clearFilter = function() {
              for (var feat in scope.rows) {
                scope.rows[feat].visible = true;
              }

              scope.filteringTable = false;
            };

            scope.selectedRow = null;
            scope.selectFeature = function(feature) {
              if (scope.selectedRow) {
                scope.selectedRow.selected = false;
              }
              if (feature) {
                feature.selected = true;
              }
              scope.selectedRow = feature;
            };

            scope.goToMap = function() {
              var projectedgeom = transformGeometry(scope.selectedRow.feature.geometry,
                  tableViewService.selectedLayer.get('metadata').projection,
                  mapService.map.getView().getView2D().getProjection());

              mapService.zoomToExtent(projectedgeom.getExtent());

              var item = {layer: tableViewService.selectedLayer, features: [scope.selectedRow.feature]};
              $('#table-view-window').modal('hide');
              featureManagerService.show(item);

            };

            $('#table-view-window').on('hidden.bs.modal', function(e) {
              tableViewService.rows = [];
              tableViewService.attributeNameList = [];
              scope.restrictions = {};

              scope.filterText = '';
              scope.filteringTable = false;
              scope.selectedRow = null;
            });
            $('#table-view-window').on('show.bs.modal', function(e) {
              scope.attributes = tableViewService.attributeNameList;

              //this needs to be deep copied so the original values will be available to pass to the feature manager
              scope.rows = clone(tableViewService.rows);
              for (var row in scope.rows) {
                if (scope.rows[row].selected === true) {
                  scope.selectedRow = scope.rows[row];
                }
              }

              scope.restrictions = tableViewService.restrictionList;
              scope.readOnly = tableViewService.readOnly;

              featureManagerService.hide();
            });

            function hasValidationErrors() {
              var numErrors = 0;
              for (var row in scope.rows) {
                var feature = scope.rows[row].feature;
                for (var prop in feature.properties) {
                  if (feature.properties[prop] !== '' && feature.properties[prop] !== null &&
                      scope.restrictions[prop] === 'int') {
                    if (!validateInteger(feature.properties[prop])) {
                      numErrors++;
                    }
                  } else if (feature.properties[prop] !== '' && feature.properties[prop] !== null &&
                      scope.restrictions[prop] === 'double') {
                    if (!validateDouble(feature.properties[prop])) {
                      numErrors++;
                    }
                  }
                }
              }
              if (numErrors > 0) {
                dialogService.warn($translate('save_attributes'), $translate('invalid_fields', {value: numErrors}),
                    [$translate('btn_ok')], false);
                return true;
              } else {
                return false;
              }
            }

            scope.saveTable = function() {
              if (hasValidationErrors() === true) {
                //returning a string, even an empty one, will stop xeditable from closing the table form
                return 'Invalid fields detected';
              }

              for (var featureIndex = 0; featureIndex < scope.rows.length; ++featureIndex) {
                var originalPropertyArray = [];
                var propertyArray = [];
                var originalFeature = tableViewService.rows[featureIndex].feature;
                var feature = scope.rows[featureIndex].feature;

                for (var prop in feature.properties) {
                  propertyArray.push({0: prop, 1: feature.properties[prop]});
                  originalPropertyArray.push({0: prop, 1: originalFeature.properties[prop]});
                }

                featureManagerService.setSelectedItem({type: 'feature', id: originalFeature.id,
                  properties: originalPropertyArray});
                featureManagerService.setSelectedItemProperties(originalPropertyArray);
                featureManagerService.setSelectedLayer(tableViewService.selectedLayer);
                featureManagerService.endAttributeEditing(true, false, propertyArray);
              }
              $.bootstrapSortable();
            };

          }
        };
      });
}());
