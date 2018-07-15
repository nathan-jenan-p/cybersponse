polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details'),
    actionStatus: {},
    displayResult: Ember.computed('block.data.details', function () {
        let results = [];
        let detail = this.get('block.data.details').result;
        let items = [];
        items.push({ key: 'Description', value: detail.description });
        items.push({ key: 'Phase', value: detail.phase.itemValue });
        items.push({ key: 'Category', value: detail.category.itemValue });
        items.push({ key: 'Severity', value: detail.severity.itemValue });
        items.push({ key: 'Status', value: detail.status.itemValue });
        if (detail.incidentLead.firstname) {
            items.push({ key: 'Incident Lead', value: detail.incidentLead.firstname + ' ' + detail.incidentLead.lastname });
        }
        items.push({ key: 'Created By', value: detail.createUser.firstname + ' ' + detail.createUser.lastname });
        if (detail.modifyUser.firstname) {
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
