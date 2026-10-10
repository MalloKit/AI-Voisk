import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/models.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';

class StoresPage extends StatefulWidget {
  const StoresPage({
    super.key,
    required this.data,
    this.initiallyUnlinked = false,
  });
  final AdminData data;
  final bool initiallyUnlinked;
  @override
  State<StoresPage> createState() => _StoresPageState();
}

class _StoresPageState extends State<StoresPage> {
  final search = TextEditingController();
  late String connection;
  String type = '전체';
  @override
  void initState() {
    super.initState();
    connection = widget.initiallyUnlinked ? '미연결' : '전체';
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final query = search.text.trim().toLowerCase();
    final stores = data.stores
        .where(
          (store) =>
              (query.isEmpty ||
                  '${store.name} ${store.representative} ${store.businessNo}'
                      .toLowerCase()
                      .contains(query)) &&
              (type == '전체' || store.type == type) &&
              (connection == '전체' ||
                  (connection == '연결됨'
                      ? store.ownerId != null
                      : store.ownerId == null)),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '매장 관리',
          description: '등록 매장의 기본 정보와 담당자, 점주 연결 현황을 확인합니다.',
        ),
        AppCard(
          child: Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.lg,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AppSearch(
                controller: search,
                label: '매장명 / 대표자 / 사업자번호',
                onChanged: (_) => setState(() {}),
              ),
              AppFilter(
                label: '업종',
                value: type,
                items: {
                  for (final type in {
                    '전체',
                    ...data.stores.map((store) => store.type),
                  })
                    type: type,
                },
                onChanged: (value) => setState(() => type = value),
              ),
              AppFilter(
                label: '점주 연결',
                value: connection,
                items: const {'전체': '전체', '연결됨': '연결됨', '미연결': '미연결'},
                onChanged: (value) => setState(() => connection = value),
              ),
              AppButton(
                label: '초기화',
                icon: Icons.refresh,
                onPressed: () => setState(() {
                  search.clear();
                  type = '전체';
                  connection = '전체';
                }),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        SectionHeading(title: '매장 목록 · ${stores.length}곳'),
        AppTable(
          columns: const ['매장명', '업종', '전화번호', '담당 관리자', '점주 연결', ''],
          rows: stores
              .map(
                (store) => DataRow(
                  key: ValueKey(store.id),
                  cells: [
                    DataCell(Text(store.name)),
                    DataCell(Text(store.type)),
                    DataCell(Text(store.phone)),
                    DataCell(Text(data.admin(store.adminId).name)),
                    DataCell(ConnectionBadge(connected: store.ownerId != null)),
                    DataCell(
                      AppButton(
                        label: '상세',
                        onPressed: () => showStoreDetails(context, data, store),
                      ),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

Future<void> showStoreDetails(
  BuildContext context,
  AdminData data,
  Store store,
) => showDetails(
  context,
  title: store.name,
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SectionHeading(title: '매장 기본 정보'),
      DetailField(label: '매장 ID', value: '${store.id}'),
      DetailField(label: '업종', value: store.type),
      DetailField(label: '대표자', value: store.representative),
      DetailField(label: '사업자번호', value: store.businessNo),
      DetailField(
        label: '주소',
        value: '${store.address} ${store.addressDetail}'.trim(),
      ),
      DetailField(label: '우편번호', value: store.postcode),
      DetailField(label: '전화번호', value: store.phone),
      const Divider(),
      const SizedBox(height: AppSpacing.lg),
      const SectionHeading(title: '담당자 및 점주 연결'),
      DetailField(label: '담당 관리자', value: data.admin(store.adminId).name),
      DetailField(
        label: '점주 로그인 ID',
        value: data.owner(store.ownerId)?.loginId ?? '미연결',
      ),
    ],
  ),
);
