function addItem(items, key, value, hide) {
    if (value) {
        items.push({ key: key, value: value, hide: hide });
    }
}

polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details'),
    actionStatus: {},
    displayResult: Ember.computed('block.data.details', function () {
        try {
            let results = [];
            let details = this.get('block.data.details');
            let detail = details.result;
            let items = [];
            addItem(items, 'Description', detail.description, true);
            addItem(items, 'Impact Assessments', detail.impactassessments, true);
            addItem(items, 'Phase', detail.phase.itemValue, true);
            addItem(items, 'Category', detail.category.itemValue, true);
            addItem(items, 'Severity', detail.severity.itemValue, true);
            addItem(items, 'Status', detail.status.itemValue, true);
            addItem(items, 'Number of Alerts', details.numberOfAlerts, true);
            if (detail.incidentLead && detail.incidentLead.firstname) {
                items.push({ key: 'Incident Lead', value: detail.incidentLead.firstname + ' ' + detail.incidentLead.lastname });
            }
            items.push({ key: 'Created By', value: detail.createUser.firstname + ' ' + detail.createUser.lastname });
            if (detail.modifyUser && detail.modifyUser.firstname) {
                items.push({ key: 'Modified By', value: detail.modifyUser.firstname + ' ' + detail.modifyUser.lastname });
            }

            let match = /^.+\/alerts\/(.+)/.exec(detail['@id'][1]);
            results.push({
                name: detail.name,
                items: items,
                alert: detail,
                id: match
            });

            return results;
        } catch (e) {
            console.error(e);
            throw e;
        }
    }),
    host: Ember.computed('block.data.details', function () {
        let details = this.get('block.data.details');
        return details.host;
    }),
    actions: {
        invokePlaybook: function (action, alert) {
            this.sendIntegrationMessage({ action: action, alert: alert })
                .then(() => {
                    let details = this.get('block.data.details');
                    let match = details.actions
                        .filter(candidate => candidate.name === action.name)
                        .pop();

                    match.success = true;

                    this.set('block.data.details', details);
                    this.notifyPropertyChange('block.data.details');
                })
                .catch(err => {
                    console.error(err);

                    let details = this.get('block.data.details');
                    let match = details.actions
                        .filter(candidate => candidate.name === action.name)
                        .pop();

                    match.error = true;

                    this.set('block.data.details', details);
                    this.notifyPropertyChange('block.data.details');
                });
        }
    }
});
