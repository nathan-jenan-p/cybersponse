polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details'),
    displayResult: Ember.computed('block.data.details', function () {
        let results = [];
        let details = this.get('block.data.details');

        details.forEach(function (detail) {
            let items = [];

            items.push(
                { key: 'Description', value: detail.description },
                { key: 'Type', value: detail.type.itemValue },
                { key: 'Severity', value: detail.severity.itemValue },
                { key: 'Status', value: detail.status.itemValue },
                { key: 'Assigned To', value: detail.assignedTo.firstname + ' ' + detail.assignedTo.lastname },
                { key: 'Created By', value: detail.createUser.firstname + ' ' + detail.createUser.lastname },
                { key: 'Modified By', value: detail.modifyUser.firstname + ' ' + detail.modifyUser.lastname }
            );

            results.push({
                name: detail.name,
                items: items
            });
        });

        return results;
    })
});
