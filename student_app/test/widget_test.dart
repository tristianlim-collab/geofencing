import 'package:flutter_test/flutter_test.dart';

import 'package:geoatt_student_app/main.dart';

void main() {
  testWidgets('App renders student header', (WidgetTester tester) async {
    await tester.pumpWidget(const GeoAttendStudentApp());
    expect(find.text('GeoAttend Student App'), findsOneWidget);
  });
}
