polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details'),
    actionStatus: {},
    displayResult: Ember.computed('block.data.details', function () {
        let results = [];
        let detail = this.get('block.data.details').result;
        let items = [];
        items.push({ key: 'Description', value: detail.description });
        items.push({ key: 'Type', value: detail.type.itemValue });
        items.push({ key: 'Severity', value: detail.severity.itemValue });
        items.push({ key: 'Status', value: detail.status.itemValue });
        if (detail.assignedTo.firstname) {
            items.push({ key: 'Assigned To', value: detail.assignedTo.firstname + ' ' + detail.assignedTo.lastname });
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
    actions: {
        invokePlaybook: function (action, alert) {
            this.sendIntegrationMessage({ action: action, alert: alert })
                .then((message) => {
                    let details = this.get('block.data.details');
                    let match = details.actions
                        .filter(candidate => candidate.name === action.name)
                        .pop();

                    match.success = true;

                    this.set('block.data.details', details);
                    this.notifyPropertyChange('block.data.details');
                });
        }
    }
});
